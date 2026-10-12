import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import {
  client,
  enrolledUser,
  sentMessages,
  TEST_SECRET,
  testNotifier,
  testStore,
  uniqueEmail,
  WEB_ORIGIN,
  sendVerificationEmail,
} from "./helpers.ts";

// Integration: a buyer abroad follows their case through the portal and never sees firm-only files.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "client portal",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    const store = testStore();
    let app: FastifyInstance;

    beforeAll(async () => {
      await store.ensureBucket();
      const auth = createAuth({
        db,
        baseURL: WEB_ORIGIN,
        secret: TEST_SECRET,
        trustedOrigins: [WEB_ORIGIN],
        sendVerificationEmail,
      });
      app = await buildApp({ db, auth, webOrigin: WEB_ORIGIN, store, notifier: testNotifier() });
    });
    afterAll(async () => {
      await app.close();
      await Promise.all([close(), admin.close()]);
    });

    /** A firm with one case, one buyer who has an email and phone, and two firm files. */
    async function setUp(name: string) {
      const { c: lawyer } = await enrolledUser(app, name);
      lawyer.useFirm((await lawyer.post("/api/v1/firms", { name: `${name} Law` })).json().id);
      const buyerEmail = uniqueEmail("buyer");
      const created = (
        await lawyer.post("/api/v1/cases", {
          propertyAddress: "14 Poseidonos Ave, Paphos",
          propertyType: "resale",
          parties: [{ role: "buyer", fullName: "Olga Ivanova", email: buyerEmail }],
        })
      ).json();
      const buyer = created.parties[0];
      await lawyer.patch(`/api/v1/cases/${created.id}/parties/${buyer.id}`, {
        phone: "+44 7700 900123",
      });

      // Two firm files: one shared with the client, one kept inside the firm.
      async function firmFile(title: string, shared: boolean) {
        const body = Buffer.from(`${title} contents`);
        const link = (
          await lawyer.post(`/api/v1/cases/${created.id}/documents/uploads`, {
            title,
            fileName: `${title}.pdf`,
            mimeType: "application/pdf",
            byteSize: body.length,
          })
        ).json();
        await fetch(link.uploadUrl, { method: "PUT", headers: link.uploadHeaders, body });
        await lawyer.post(`/api/v1/documents/versions/${link.versionId}/complete`);
        // Stand in for the scanner, which runs in the worker.
        await admin.db
          .update(schema.documentVersions)
          .set({ scanStatus: "clean", review: "accepted" })
          .where(eq(schema.documentVersions.id, link.versionId));
        if (shared)
          await lawyer.patch(`/api/v1/documents/${link.documentId}`, { visibility: "client" });
        return link as { documentId: string; versionId: string };
      }
      const shared = await firmFile("Sale contract draft", true);
      const internal = await firmFile("Internal file note", false);
      await lawyer.post(`/api/v1/cases/${created.id}/documents/requests`, {
        requirementKey: "funds",
        requested: true,
      });
      return { lawyer, caseId: created.id as string, buyer, buyerEmail, shared, internal };
    }

    /** Follows the emailed link and the texted code, as the buyer would. */
    async function signIn(email: string) {
      const invite = sentMessages.filter((m) => m.to === email).at(-1)!;
      const token = (invite.data as { link: string }).link.split("/portal/link/")[1]!;
      const portal = client(app);
      const start = await portal.post(`/api/portal/link/${token}/start`, {});
      expect(start.statusCode).toBe(200);
      const sms = sentMessages.filter((m) => m.channel === "sms").at(-1)!;
      const code = (sms.data as { code: string }).code;
      return { portal, token, code, start: start.json() };
    }

    it("lets a buyer abroad follow the case and send a document, and nothing more", async () => {
      const { lawyer, caseId, buyer, buyerEmail, shared, internal } = await setUp("Portal Lawyer");
      expect(
        (await lawyer.post(`/api/v1/cases/${caseId}/parties/${buyer.id}/portal`, { locale: "ru" }))
          .statusCode,
      ).toBe(204);
      const invite = sentMessages.filter((m) => m.to === buyerEmail).at(-1)!;
      expect(invite).toMatchObject({ template: "portal-invitation", locale: "ru" });

      const { portal, token, code, start } = await signIn(buyerEmail);
      expect(start).toMatchObject({
        partyName: "Olga Ivanova",
        maskedPhone: "+447 •••••• 123",
        sent: true,
      });
      // The link alone is not enough: a wrong code is refused.
      const wrong = await portal.post(`/api/portal/link/${token}/verify`, {
        code: code === "000000" ? "111111" : "000000",
      });
      expect(wrong.json().messageKey).toBe("codeWrong");
      expect((await portal.post(`/api/portal/link/${token}/verify`, { code })).statusCode).toBe(
        204,
      );
      // A spent link cannot be used again.
      expect(
        (await client(app).post(`/api/portal/link/${token}/start`, {})).json().messageKey,
      ).toBe("linkUsed");

      // Privacy first: the case stays closed until the client accepts the notice.
      expect((await portal.get("/api/portal/case")).json().messageKey).toBe("privacyNeeded");
      expect((await portal.post("/api/portal/privacy/accept", {})).statusCode).toBe(204);
      const view = (await portal.get("/api/portal/case")).json();
      expect(view.case.stages[0]).toMatchObject({ key: "reservation", position: "current" });
      const titles = view.documents.map((d: { title: string }) => d.title).sort();
      expect(titles).toEqual(["Sale contract draft", "Where the money sits"].sort());
      expect(JSON.stringify(view)).not.toContain("Internal file note");

      // Firm-only files never reach the client, even by guessing their id.
      expect(
        (await portal.get(`/api/portal/documents/${shared.versionId}/download`)).statusCode,
      ).toBe(200);
      expect(
        (await portal.get(`/api/portal/documents/${internal.versionId}/download`)).statusCode,
      ).toBe(404);
      const sneaky = await portal.post("/api/portal/uploads", {
        documentId: internal.documentId,
        fileName: "x.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
      });
      expect(sneaky.statusCode).toBe(404);

      // The buyer answers the request; the file waits for the lawyer.
      const requested = view.documents.find((d: { requested: boolean }) => d.requested);
      const bytes = Buffer.from("Bank statement");
      const up = (
        await portal.post("/api/portal/uploads", {
          documentId: requested.id,
          fileName: "statement.pdf",
          mimeType: "application/pdf",
          byteSize: bytes.length,
        })
      ).json();
      await fetch(up.uploadUrl, { method: "PUT", headers: up.uploadHeaders, body: bytes });
      expect(
        (await portal.post(`/api/portal/uploads/${up.versionId}/complete`, {})).statusCode,
      ).toBe(204);
      const mine = (await portal.get("/api/portal/case"))
        .json()
        .documents.find((d: { id: string }) => d.id === requested.id);
      expect(mine.latest).toMatchObject({
        fromYou: true,
        fileName: "statement.pdf",
        scanStatus: "pending",
      });

      // The firm sees who sent it.
      const firmView = (await lawyer.get(`/api/v1/cases/${caseId}/documents`)).json();
      const item = firmView.stages
        .flatMap((s: { items: unknown[] }) => s.items)
        .find((i: { requirementKey: string }) => i.requirementKey === "funds");
      expect(item.document.versions[0]).toMatchObject({
        byClient: true,
        uploadedBy: "Olga Ivanova",
      });

      // Sharing consent is recorded and can be withdrawn.
      expect(
        (
          await portal.post("/api/portal/consents", {
            granteeType: "bank",
            email: "loans@bank.example",
          })
        ).statusCode,
      ).toBe(204);
      const consent = (await portal.get("/api/portal/case")).json().consents[0];
      expect(consent).toMatchObject({
        granteeType: "bank",
        granteeRef: "loans@bank.example",
        revokedAt: null,
      });
      expect((await portal.delete(`/api/portal/consents/${consent.id}`)).statusCode).toBe(204);

      // Revoking access ends the session at once.
      const [access] = (await lawyer.get(`/api/v1/cases/${caseId}/portal`)).json();
      expect(access.lastSeenAt).not.toBeNull();
      expect((await lawyer.delete(`/api/v1/portal-access/${access.id}`)).statusCode).toBe(204);
      expect((await portal.get("/api/portal/case")).statusCode).toBe(401);
    });

    it("keeps a client inside their own case", async () => {
      const first = await setUp("First Firm");
      const second = await setUp("Second Firm");
      await first.lawyer.post(`/api/v1/cases/${first.caseId}/parties/${first.buyer.id}/portal`, {
        locale: "en",
      });
      const { portal, token, code } = await signIn(first.buyerEmail);
      await portal.post(`/api/portal/link/${token}/verify`, { code });
      await portal.post("/api/portal/privacy/accept", {});
      // Even another firm's shared file is out of reach.
      expect(
        (await portal.get(`/api/portal/documents/${second.shared.versionId}/download`)).statusCode,
      ).toBe(404);
      // Without a session there is nothing to see.
      expect((await client(app).get("/api/portal/case")).statusCode).toBe(401);
    });

    it("ends portal access when a party is removed or their contact details change", async () => {
      const { lawyer, caseId, buyer, buyerEmail } = await setUp("Removing Lawyer");
      const url = `/api/v1/cases/${caseId}`;
      // The only buyer cannot be removed.
      const version = (await lawyer.get(url)).headers.etag as string;
      const lastBuyer = await lawyer.delete(`${url}/parties/${buyer.id}`, { "if-match": version });
      expect(lastBuyer.json().messageKey).toBe("caseNeedsBuyer");

      await lawyer.post(`${url}/parties/${buyer.id}/portal`, { locale: "en" });
      const first = await signIn(buyerEmail);
      await first.portal.post(`/api/portal/link/${first.token}/verify`, { code: first.code });
      await first.portal.post("/api/portal/privacy/accept", {});
      expect((await first.portal.get("/api/portal/case")).statusCode).toBe(200);

      // A new phone number ends the old session, so the client signs in again.
      await lawyer.patch(`${url}/parties/${buyer.id}`, { phone: "+357 99 555666" });
      expect((await first.portal.get("/api/portal/case")).statusCode).toBe(401);

      // With a second buyer on the case, the first can be removed.
      const added = await lawyer.post(
        `${url}/parties`,
        { role: "buyer", fullName: "Second Buyer" },
        { "if-match": (await lawyer.get(url)).headers.etag as string },
      );
      expect(added.statusCode).toBe(200);
      await lawyer.post(`${url}/parties/${buyer.id}/portal`, { locale: "en" });
      const second = await signIn(buyerEmail);
      await second.portal.post(`/api/portal/link/${second.token}/verify`, { code: second.code });
      const removed = await lawyer.delete(`${url}/parties/${buyer.id}`, {
        "if-match": added.headers.etag as string,
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().parties.map((p: { fullName: string }) => p.fullName)).toEqual([
        "Second Buyer",
      ]);
      expect((await second.portal.get("/api/portal/me")).statusCode).toBe(401);
    });

    it("never shows one client another client's files", async () => {
      const { lawyer, caseId, buyer, buyerEmail, shared } = await setUp("Two Party Lawyer");
      const url = `/api/v1/cases/${caseId}`;
      const sellerEmail = uniqueEmail("seller");
      const withSeller = await lawyer.post(
        `${url}/parties`,
        { role: "seller", fullName: "Petros Sellas", email: sellerEmail, phone: "+357 99 777888" },
        { "if-match": (await lawyer.get(url)).headers.etag as string },
      );
      const seller = withSeller.json().parties.find((p: { role: string }) => p.role === "seller");

      async function portalFor(partyId: string, email: string) {
        await lawyer.post(`${url}/parties/${partyId}/portal`, { locale: "en" });
        const s = await signIn(email);
        await s.portal.post(`/api/portal/link/${s.token}/verify`, { code: s.code });
        await s.portal.post("/api/portal/privacy/accept", {});
        return s.portal;
      }
      const buyerPortal = await portalFor(buyer.id, buyerEmail);

      // The buyer sends a passport of their own accord.
      const bytes = Buffer.from("passport scan");
      const up = (
        await buyerPortal.post("/api/portal/uploads", {
          title: "My passport",
          fileName: "passport.pdf",
          mimeType: "application/pdf",
          byteSize: bytes.length,
        })
      ).json();
      await fetch(up.uploadUrl, { method: "PUT", headers: up.uploadHeaders, body: bytes });
      await buyerPortal.post(`/api/portal/uploads/${up.versionId}/complete`, {});
      await admin.db
        .update(schema.documentVersions)
        .set({ scanStatus: "clean" })
        .where(eq(schema.documentVersions.id, up.versionId));

      // The buyer cannot slip a file into a document the firm shared.
      const intoShared = await buyerPortal.post("/api/portal/uploads", {
        documentId: shared.documentId,
        fileName: "fake.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
      });
      expect(intoShared.statusCode).toBe(404);

      // The seller sees the firm's shared file, and nothing of the buyer's.
      const sellerPortal = await portalFor(seller.id, sellerEmail);
      const view = JSON.stringify((await sellerPortal.get("/api/portal/case")).json());
      expect(view).toContain("Sale contract draft");
      expect(view).not.toContain("My passport");
      expect(
        (await sellerPortal.get(`/api/portal/documents/${up.versionId}/download`)).statusCode,
      ).toBe(404);
      // The buyer still has it.
      expect(
        (await buyerPortal.get(`/api/portal/documents/${up.versionId}/download`)).statusCode,
      ).toBe(200);
    });

    it("emails a fresh link to a known client without saying who is known", async () => {
      const { lawyer, caseId, buyer, buyerEmail } = await setUp("Link Lawyer");
      await lawyer.post(`/api/v1/cases/${caseId}/parties/${buyer.id}/portal`, { locale: "el" });
      const before = sentMessages.length;
      expect(
        (await client(app).post("/api/portal/sign-in", { email: buyerEmail })).statusCode,
      ).toBe(204);
      expect(
        (await client(app).post("/api/portal/sign-in", { email: uniqueEmail("nobody") }))
          .statusCode,
      ).toBe(204);
      // The emails go out after the answer, so the timing reveals nothing; wait for them.
      for (let i = 0; i < 50 && sentMessages.length === before; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 200));
      const fresh = sentMessages.slice(before);
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ template: "portal-sign-in", locale: "el", to: buyerEmail });
    });
  },
);
