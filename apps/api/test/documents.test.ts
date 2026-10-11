import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import { enrolledUser, TEST_SECRET, testStore, WEB_ORIGIN } from "./helpers.ts";

// Integration: document routes against the local Postgres and object storage.
describe.skipIf(!process.env.DATABASE_URL)("documents", () => {
  const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
  let app: FastifyInstance;

  beforeAll(async () => {
    const store = testStore();
    await store.ensureBucket();
    const auth = createAuth({
      db,
      baseURL: WEB_ORIGIN,
      secret: TEST_SECRET,
      trustedOrigins: [WEB_ORIGIN],
    });
    app = await buildApp({ db, auth, webOrigin: WEB_ORIGIN, store });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  async function caseFor(name: string) {
    const { c } = await enrolledUser(app, name);
    c.useFirm((await c.post("/api/v1/firms", { name: `${name} Law` })).json().id);
    const created = await c.post("/api/v1/cases", {
      propertyAddress: "7 Ledra Street, Nicosia",
      propertyType: "resale",
      parties: [{ role: "buyer", fullName: "Maria Georgiou" }],
    });
    return { c, caseId: created.json().id as string };
  }

  it("uploads through a signed link and keeps the file locked until it is scanned", async () => {
    const { c, caseId } = await caseFor("Upload Lawyer");
    const body = Buffer.from("%PDF-1.4 sale contract");
    const link = await c.post(`/api/v1/cases/${caseId}/documents/uploads`, {
      requirementKey: "contract",
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      byteSize: body.length,
    });
    expect(link.statusCode).toBe(201);
    const { uploadUrl, uploadHeaders, versionId, documentId } = link.json();
    expect(uploadUrl).toContain("/quarantine/");

    // Confirming before the bytes arrive is refused.
    expect((await c.post(`/api/v1/documents/versions/${versionId}/complete`)).statusCode).toBe(422);
    const put = await fetch(uploadUrl, { method: "PUT", headers: uploadHeaders, body });
    expect(put.status).toBe(200);
    const done = await c.post(`/api/v1/documents/versions/${versionId}/complete`);
    expect(done.json().scanStatus).toBe("pending");

    const download = await c.get(`/api/v1/documents/versions/${versionId}/download`);
    expect(download.statusCode).toBe(409);

    const list = (await c.get(`/api/v1/cases/${caseId}/documents`)).json();
    const item = list.stages
      .flatMap((s: { items: { requirementKey: string; state: string }[] }) => s.items)
      .find((i: { requirementKey: string }) => i.requirementKey === "contract");
    expect(item.state).toBe("scanning");

    // New documents stay inside the firm until a lawyer shares them.
    const shared = await c.patch(`/api/v1/documents/${documentId}`, { visibility: "client" });
    expect(shared.statusCode).toBe(204);
  });

  it("refuses file types and sizes it does not accept", async () => {
    const { c, caseId } = await caseFor("Strict Lawyer");
    const url = `/api/v1/cases/${caseId}/documents/uploads`;
    const exe = await c.post(url, {
      title: "Setup",
      fileName: "setup.exe",
      mimeType: "application/x-msdownload",
      byteSize: 10,
    });
    expect(exe.statusCode).toBe(422);
    const huge = await c.post(url, {
      title: "Scan",
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      byteSize: 26 * 1024 * 1024,
    });
    expect(huge.statusCode).toBe(422);
    const unknown = await c.post(url, {
      requirementKey: "nope",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
    });
    expect(unknown.statusCode).toBe(422);
  });

  it("hides one firm's documents from another firm", async () => {
    const { caseId } = await caseFor("Owner Lawyer");
    const { c: outsider } = await caseFor("Outsider Lawyer");
    expect((await outsider.get(`/api/v1/cases/${caseId}/documents`)).statusCode).toBe(404);
    const upload = await outsider.post(`/api/v1/cases/${caseId}/documents/uploads`, {
      title: "Sneaky",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      byteSize: 10,
    });
    expect(upload.statusCode).toBe(404);
  });
});
