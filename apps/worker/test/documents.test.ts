import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import { openCase } from "@kleidi/modules/cases";
import {
  completeUpload,
  createClamdScanner,
  createS3Store,
  downloadLink,
  flagExpiringDocuments,
  listCaseDocuments,
  requestUpload,
  scanUploadedVersion,
  type Scanner,
} from "@kleidi/modules/documents";
import { createFirm } from "@kleidi/modules/firms";

// The standard anti-virus test file: harmless, but every scanner reports it as infected.
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const clamdUp = await new Promise<boolean>((resolve) => {
  const s = connect(Number(process.env.CLAMD_PORT ?? 3310), process.env.CLAMD_HOST ?? "localhost");
  s.on("connect", () => (s.end(), resolve(true)));
  s.on("error", () => resolve(false));
});

/** Recognises only the EICAR string, for runs without a ClamAV daemon. */
const fakeScanner: Scanner = {
  async scan(file) {
    let text = "";
    for await (const chunk of file) text += Buffer.from(chunk as Uint8Array).toString();
    return text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")
      ? { clean: false, signature: "Eicar-Test-Signature" }
      : { clean: true };
  },
};
const scanner = clamdUp
  ? createClamdScanner({
      host: process.env.CLAMD_HOST ?? "localhost",
      port: Number(process.env.CLAMD_PORT ?? 3310),
    })
  : fakeScanner;

// Integration: needs the local Postgres and object storage. Uses real ClamAV when it is running.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "document pipeline",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    const store = createS3Store({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
      publicEndpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
      region: process.env.S3_REGION ?? "fr-par",
      bucket: process.env.S3_BUCKET ?? "kleidi-documents",
      accessKeyId: process.env.S3_ACCESS_KEY ?? "kleidi",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "kleidi-dev-secret",
    });
    let ctx: {
      firm: { firmId: string; role: "firm_admin" };
      actor: { userId: string; name: string; email: string };
    };
    let caseId: string;

    beforeAll(async () => {
      await store.ensureBucket();
      const [user] = await admin.db
        .insert(schema.users)
        .values({
          name: "Doc Tester",
          email: `docs.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      const actor = { userId: user!.id, name: user!.name, email: user!.email };
      const firm = await createFirm(db, { name: "Document Test & Co", actor });
      ctx = { firm: { firmId: firm.id, role: "firm_admin" }, actor };
      const created = await openCase(db, {
        ...ctx,
        propertyAddress: "3 Archbishop Makarios Ave, Larnaca",
        propertyType: "resale",
        parties: [{ role: "buyer", fullName: "Anna Petrova" }],
      });
      caseId = created.id;
    });
    afterAll(async () => Promise.all([close(), admin.close()]));

    /** Uploads like the browser does: ask for a link, PUT the bytes, confirm. */
    async function upload(requirementKey: string, body: string, expiresOn?: string) {
      const bytes = Buffer.from(body);
      const link = await requestUpload(db, store, {
        ...ctx,
        caseId,
        target: { requirementKey },
        fileName: `${requirementKey}.txt`,
        mimeType: "text/plain",
        byteSize: bytes.length,
      });
      const put = await fetch(link.uploadUrl, {
        method: "PUT",
        headers: link.uploadHeaders,
        body: bytes,
      });
      expect(put.status).toBe(200);
      await completeUpload(db, store, {
        ...ctx,
        versionId: link.versionId,
        ...(expiresOn ? { expiresOn } : {}),
      });
      return { link };
    }

    async function uploadedEvent(versionId: string): Promise<StoredEvent> {
      const rows = await admin.db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.type, "documents.VersionUploaded"));
      const row = rows.find((r) => r.payload.versionId === versionId)!;
      return { ...row, occurredAt: row.occurredAt.toISOString() };
    }

    it(`releases a clean file and quarantines an infected one (${clamdUp ? "ClamAV" : "test scanner"})`, async () => {
      const clean = await upload("title_deed", "Title deed for plot 0/12345, issued 2019.");
      await expect(downloadLink(db, store, ctx.firm.firmId, clean.link.versionId)).rejects.toThrow(
        /being checked/,
      );
      expect(
        await scanUploadedVersion(db, store, scanner, await uploadedEvent(clean.link.versionId)),
      ).toBe(true);
      const { url } = await downloadLink(db, store, ctx.firm.firmId, clean.link.versionId);
      expect(await (await fetch(url)).text()).toContain("Title deed for plot");

      const infected = await upload("planning_zone", EICAR);
      await scanUploadedVersion(db, store, scanner, await uploadedEvent(infected.link.versionId));
      await expect(
        downloadLink(db, store, ctx.firm.firmId, infected.link.versionId),
      ).rejects.toThrow(/quarantined/);

      const docs = await listCaseDocuments(db, ctx.firm.firmId, caseId);
      const dd = docs.stages.find((s) => s.key === "due_diligence")!;
      const state = (key: string) => dd.items.find((i) => i.requirementKey === key)!.state;
      expect(state("title_deed")).toBe("ready");
      expect(state("planning_zone")).toBe("infected");
      // Items needing attention sit above finished ones.
      expect(dd.items.findIndex((i) => i.requirementKey === "planning_zone")).toBeLessThan(
        dd.items.findIndex((i) => i.requirementKey === "title_deed"),
      );
    });

    it("keeps every version and scans each one", async () => {
      const first = await upload("encumbrances", "Search certificate, first copy.");
      await scanUploadedVersion(db, store, scanner, await uploadedEvent(first.link.versionId));
      const second = await upload("encumbrances", "Search certificate, refreshed.");
      expect(second.link.version).toBe(first.link.version + 1);
      await scanUploadedVersion(db, store, scanner, await uploadedEvent(second.link.versionId));
      const docs = await listCaseDocuments(db, ctx.firm.firmId, caseId);
      const item = docs.stages
        .flatMap((s) => s.items)
        .find((i) => i.requirementKey === "encumbrances")!;
      expect(item.document!.versions.map((v) => v.scanStatus)).toEqual(["clean", "clean"]);
      // A search certificate goes stale 30 days after upload.
      expect(item.document!.expiresOn).not.toBeNull();
    });

    it("flags an expiring document once", async () => {
      const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const doc = await upload("developer", "Building permit.", soon);
      await scanUploadedVersion(db, store, scanner, await uploadedEvent(doc.link.versionId));
      const flagged = async () =>
        (
          await admin.db
            .select()
            .from(schema.outbox)
            .where(eq(schema.outbox.type, "documents.ExpiryFlagged"))
        ).filter((r) => r.payload.documentId === doc.link.documentId);
      await flagExpiringDocuments(db);
      expect((await flagged()).map((r) => r.payload.state)).toEqual(["expiring"]);
      await flagExpiringDocuments(db);
      expect(await flagged()).toHaveLength(1);
    });

    it("hides one firm's documents from another firm", async () => {
      const [other] = await admin.db
        .insert(schema.users)
        .values({
          name: "Other Firm",
          email: `other.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      const otherFirm = await createFirm(db, {
        name: "Other Firm",
        actor: { userId: other!.id, name: other!.name, email: other!.email },
      });
      await expect(listCaseDocuments(db, otherFirm.id, caseId)).rejects.toThrow(/not found/);
    });
  },
);
