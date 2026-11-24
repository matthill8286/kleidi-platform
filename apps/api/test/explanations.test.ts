import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import {
  listClientExplanations,
  scanUploadedVersion,
  type Assist,
} from "@kleidi/modules/documents";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import {
  enrolledUser,
  sendVerificationEmail,
  TEST_SECRET,
  testNotifier,
  testStore,
  WEB_ORIGIN,
} from "./helpers.ts";

const EXPLANATION = {
  document_type: "land_registry_search",
  title_status: "trapped",
  plain_english_summary: "The developer still owns the land and it is mortgaged.",
};

// Integration: a lawyer asks Kleidi Assist to explain a clean case document, then shares it.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "explanations",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    const store = testStore();
    const calls: Parameters<Assist["explainCyprus"]>[0][] = [];
    const assist: Assist = {
      async explainCyprus(input) {
        calls.push(input);
        return { explanation: EXPLANATION, markdown: "# Explained", model: "gpt-test" };
      },
    };
    let app: FastifyInstance;
    let bare: FastifyInstance;

    beforeAll(async () => {
      await store.ensureBucket();
      const auth = createAuth({
        db,
        baseURL: WEB_ORIGIN,
        secret: TEST_SECRET,
        trustedOrigins: [WEB_ORIGIN],
        sendVerificationEmail,
      });
      const base = { db, auth, webOrigin: WEB_ORIGIN, store, notifier: testNotifier() };
      app = await buildApp({ ...base, assist });
      bare = await buildApp(base);
    });
    afterAll(async () => {
      await Promise.all([app.close(), bare.close()]);
      await Promise.all([close(), admin.close()]);
    });

    async function caseFor(name: string, server = app) {
      const { c } = await enrolledUser(server, name);
      const firmId = (await c.post("/api/v1/firms", { name: `${name} Law` })).json().id as string;
      c.useFirm(firmId);
      const created = await c.post("/api/v1/cases", {
        propertyAddress: "Flat A12, Peyia, Paphos",
        propertyType: "offplan",
        parties: [{ role: "buyer", fullName: "James Hart" }],
      });
      return { c, firmId, caseId: created.json().id as string };
    }

    /** Uploads a file and, unless told otherwise, runs the virus scan so it is clean. */
    async function upload(
      c: Awaited<ReturnType<typeof caseFor>>["c"],
      caseId: string,
      file: { name: string; type: string; body: Buffer },
      scan = true,
    ) {
      const link = (
        await c.post(`/api/v1/cases/${caseId}/documents/uploads`, {
          title: "Land Registry search",
          fileName: file.name,
          mimeType: file.type,
          byteSize: file.body.length,
        })
      ).json();
      await fetch(link.uploadUrl, { method: "PUT", headers: link.uploadHeaders, body: file.body });
      await c.post(`/api/v1/documents/versions/${link.versionId}/complete`);
      if (scan) {
        const rows = await admin.db
          .select()
          .from(schema.outbox)
          .where(eq(schema.outbox.type, "documents.VersionUploaded"));
        const row = rows.find((r) => r.payload.versionId === link.versionId)!;
        const event = { ...row, occurredAt: row.occurredAt.toISOString() } as StoredEvent;
        await scanUploadedVersion(db, store, { scan: async () => ({ clean: true }) }, event);
      }
      return link as { versionId: string; documentId: string };
    }

    const pdf = {
      name: "search.pdf",
      type: "application/pdf",
      body: Buffer.from("%PDF-1.4 search certificate"),
    };

    it("explains a clean document and keeps the explanation inside the firm", async () => {
      const { c, firmId, caseId } = await caseFor("Explaining Lawyer");
      const { versionId, documentId } = await upload(c, caseId, pdf);

      const res = await c.post(`/api/v1/documents/versions/${versionId}/explanations`, {
        question: "Can my client get a title deed?",
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        documentId,
        versionId,
        documentTitle: "Land Registry search",
        fileName: "search.pdf",
        question: "Can my client get a title deed?",
        result: EXPLANATION,
        markdown: "# Explained",
        model: "gpt-test",
        sharedWithClient: false,
        createdBy: "Explaining Lawyer",
      });
      expect(calls.at(-1)).toEqual({
        document: { name: "search.pdf", mediaType: "application/pdf", bytes: pdf.body },
        question: "Can my client get a title deed?",
      });

      const list = await c.get(`/api/v1/cases/${caseId}/explanations`);
      expect(list.json()).toHaveLength(1);
      expect(await listClientExplanations(db, firmId, caseId)).toEqual([]);
    });

    it("shows a shared explanation to the client, and hides it again when unshared", async () => {
      const { c, firmId, caseId } = await caseFor("Sharing Lawyer");
      const { versionId } = await upload(c, caseId, pdf);
      const id = (await c.post(`/api/v1/documents/versions/${versionId}/explanations`, {})).json()
        .id;

      expect(
        (await c.patch(`/api/v1/explanations/${id}`, { sharedWithClient: true })).statusCode,
      ).toBe(204);
      const shared = await listClientExplanations(db, firmId, caseId);
      expect(shared).toEqual([
        expect.objectContaining({ id, documentTitle: "Land Registry search", result: EXPLANATION }),
      ]);
      // The firm-only fields stay out of the portal.
      expect(shared[0]).not.toHaveProperty("question");

      await c.patch(`/api/v1/explanations/${id}`, { sharedWithClient: false });
      expect(await listClientExplanations(db, firmId, caseId)).toEqual([]);
    });

    it("waits for the virus scan and refuses file types the explainer cannot read", async () => {
      const { c, caseId } = await caseFor("Careful Lawyer");
      const pending = await upload(c, caseId, pdf, false);
      const early = await c.post(
        `/api/v1/documents/versions/${pending.versionId}/explanations`,
        {},
      );
      expect(early.statusCode).toBe(409);
      expect(early.json()).toMatchObject({ messageKey: "fileScanning" });

      const docx = await upload(c, caseId, {
        name: "contract.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: Buffer.from("PK word"),
      });
      const res = await c.post(`/api/v1/documents/versions/${docx.versionId}/explanations`, {});
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ messageKey: "explainUnsupported" });
    });

    it("keeps one firm out of another firm's documents and explanations", async () => {
      const { c, caseId } = await caseFor("Owner Lawyer");
      const { versionId } = await upload(c, caseId, pdf);
      const id = (await c.post(`/api/v1/documents/versions/${versionId}/explanations`, {})).json()
        .id;
      const { c: outsider } = await caseFor("Outsider Lawyer");
      expect(
        (await outsider.post(`/api/v1/documents/versions/${versionId}/explanations`, {}))
          .statusCode,
      ).toBe(404);
      expect(
        (await outsider.patch(`/api/v1/explanations/${id}`, { sharedWithClient: true })).statusCode,
      ).toBe(404);
    });

    it("reports the feature as off when Kleidi Assist is not configured", async () => {
      const { c, caseId } = await caseFor("Offline Lawyer", bare);
      expect((await c.get("/api/v1/features")).json()).toEqual({ assist: false });
      const { versionId } = await upload(c, caseId, pdf);
      const res = await c.post(`/api/v1/documents/versions/${versionId}/explanations`, {});
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ messageKey: "assistUnavailable" });
    });

    it("reports the feature as on when it is configured", async () => {
      const { c } = await caseFor("Online Lawyer");
      expect((await c.get("/api/v1/features")).json()).toEqual({ assist: true });
    });
  },
);
