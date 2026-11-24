import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import type { Assist } from "@kleidi/modules/documents";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import {
  client,
  enrolledUser,
  sendVerificationEmail,
  sentMessages,
  TEST_SECRET,
  testNotifier,
  testStore,
  uniqueEmail,
  WEB_ORIGIN,
} from "./helpers.ts";

const REVIEW = {
  computed: { yearsRemaining: 103.1 },
  flags: [{ code: "doubling_rent", severity: "high", title: "The ground rent doubles" }],
};

// Integration: a lawyer reviews a lease with Kleidi Assist, edits and approves the buyer's
// summary, and the buyer reads it in their own language.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "lease review",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    const store = testStore();
    const calls: {
      review: Parameters<Assist["reviewLease"]>[0][];
      translate: Parameters<Assist["translate"]>[0][];
    } = {
      review: [],
      translate: [],
    };
    const assist: Assist = {
      async explainCyprus() {
        throw new Error("Not used in these tests");
      },
      async reviewLease(input) {
        calls.review.push(input);
        return {
          review: REVIEW,
          report: "# Report on the lease",
          buyerSummary: "## Your lease\n\n- **Years left:** 103.1.",
          model: "gpt-test",
        };
      },
      async translate(input) {
        calls.translate.push(input);
        return { translations: { el: `[el] ${input.text}`, ru: `[ru] ${input.text}` } };
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
      await Promise.all([app?.close(), bare?.close()]);
      await Promise.all([close(), admin.close()]);
    });

    /** An England and Wales firm with one case, a lease on it, and the buyer in the portal. */
    async function leaseholdCase(
      name: string,
      opts: { jurisdiction?: string; tenure?: string; server?: FastifyInstance } = {},
    ) {
      const server = opts.server ?? app;
      const { c: lawyer } = await enrolledUser(server, name);
      lawyer.useFirm(
        (
          await lawyer.post("/api/v1/firms", {
            name: `${name} LLP`,
            jurisdictionCode: opts.jurisdiction ?? "EW",
          })
        ).json().id,
      );
      const buyerEmail = uniqueEmail("buyer");
      const created = (
        await lawyer.post("/api/v1/cases", {
          propertyAddress: "Flat 12, Quayside House, Bristol",
          propertyType: "resale",
          ...(opts.tenure === "none" ? {} : { tenure: opts.tenure ?? "leasehold" }),
          parties: [{ role: "buyer", fullName: "Amira Khan", email: buyerEmail }],
        })
      ).json();
      const body = Buffer.from("%PDF lease");
      const link = (
        await lawyer.post(`/api/v1/cases/${created.id}/documents/uploads`, {
          title: "Lease",
          fileName: "lease.pdf",
          mimeType: "application/pdf",
          byteSize: body.length,
        })
      ).json();
      await fetch(link.uploadUrl, { method: "PUT", headers: link.uploadHeaders, body });
      await lawyer.post(`/api/v1/documents/versions/${link.versionId}/complete`);
      return {
        lawyer,
        caseId: created.id as string,
        buyer: created.parties[0],
        buyerEmail,
        link,
        body,
      };
    }

    const clean = (versionId: string) =>
      admin.db
        .update(schema.documentVersions)
        .set({ scanStatus: "clean" })
        .where(eq(schema.documentVersions.id, versionId));

    it("reviews the lease, lets the lawyer edit the draft, and shows the buyer nothing yet", async () => {
      const { lawyer, caseId, link, body } = await leaseholdCase("Lease Lawyer");
      // Not until the virus scan has passed.
      const early = await lawyer.post(`/api/v1/cases/${caseId}/lease-review`, {
        documentId: link.documentId,
      });
      expect(early.json().messageKey).toBe("fileScanning");
      await clean(link.versionId);

      const res = await lawyer.post(`/api/v1/cases/${caseId}/lease-review`, {
        documentId: link.documentId,
        plansToLet: true,
        propertyValue: 250000,
      });
      expect(res.statusCode).toBe(201);
      const review = res.json();
      expect(review).toMatchObject({
        status: "draft",
        documentTitle: "Lease",
        result: REVIEW,
        buyer: { plansToLet: true, propertyValue: 250000 },
      });
      expect(calls.review.at(-1)).toMatchObject({
        document: { name: "lease.pdf", mediaType: "application/pdf" },
        buyer: { plansToLet: true, propertyValue: 250000 },
      });
      expect(Buffer.compare(calls.review.at(-1)!.document.bytes, body)).toBe(0);

      const edited = await lawyer.patch(`/api/v1/lease-reviews/${review.id}`, {
        buyerSummary: "## Your lease\n\n103 years left.",
      });
      expect(edited.json().buyerSummary).toBe("## Your lease\n\n103 years left.");
      expect((await lawyer.get(`/api/v1/cases/${caseId}/lease-review`)).json()).toMatchObject({
        available: true,
        review: { id: review.id, status: "draft" },
      });

      // The worker turns this event into the case's activity entry.
      const events = await admin.db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.type, "documents.LeaseReviewed"));
      expect(events.find((e) => e.payload.entityId === caseId)?.payload).toMatchObject({
        reviewId: review.id,
        flags: 1,
        title: "Lease",
      });
    });

    it("translates the approved summary and shows it to the buyer in their language", async () => {
      const { lawyer, caseId, link, buyer, buyerEmail } = await leaseholdCase("Approve Lawyer");
      await clean(link.versionId);
      const review = (
        await lawyer.post(`/api/v1/cases/${caseId}/lease-review`, { documentId: link.documentId })
      ).json();

      // The buyer joins the portal in Greek.
      await lawyer.patch(`/api/v1/cases/${caseId}/parties/${buyer.id}`, {
        phone: "+44 7700 900123",
      });
      await lawyer.post(`/api/v1/cases/${caseId}/parties/${buyer.id}/portal`, { locale: "el" });
      const token = (
        sentMessages.filter((m) => m.to === buyerEmail).at(-1)!.data as { link: string }
      ).link.split("/portal/link/")[1]!;
      const portal = client(app);
      await portal.post(`/api/portal/link/${token}/start`, {});
      const code = (
        sentMessages.filter((m) => m.channel === "sms").at(-1)!.data as { code: string }
      ).code;
      await portal.post(`/api/portal/link/${token}/verify`, { code });
      await portal.post("/api/portal/privacy/accept", {});
      expect((await portal.get("/api/portal/lease-summary")).json()).toEqual({ summary: null });

      const approved = (await lawyer.post(`/api/v1/lease-reviews/${review.id}/approve`, {})).json();
      expect(approved).toMatchObject({ status: "approved" });
      expect(calls.translate.at(-1)).toEqual({ text: review.buyerSummary, to: ["el", "ru"] });

      expect((await portal.get("/api/portal/lease-summary")).json().summary).toMatchObject({
        markdown: `[el] ${review.buyerSummary}`,
        locale: "el",
      });
      expect(
        (await portal.get("/api/portal/lease-summary?locale=en")).json().summary,
      ).toMatchObject({ markdown: review.buyerSummary, locale: "en" });

      // Approved reviews are locked.
      const late = await lawyer.patch(`/api/v1/lease-reviews/${review.id}`, { report: "Changed" });
      expect(late.json().messageKey).toBe("leaseReviewApproved");
    });

    it("is only for leasehold sales in England and Wales", async () => {
      const freehold = await leaseholdCase("Freehold Lawyer", { tenure: "freehold" });
      await clean(freehold.link.versionId);
      expect(
        (
          await freehold.lawyer.post(`/api/v1/cases/${freehold.caseId}/lease-review`, {
            documentId: freehold.link.documentId,
          })
        ).json().messageKey,
      ).toBe("leaseReviewNotApplicable");
      const cyprus = await leaseholdCase("Cyprus Lawyer", { jurisdiction: "CY", tenure: "none" });
      await clean(cyprus.link.versionId);
      expect(
        (
          await cyprus.lawyer.post(`/api/v1/cases/${cyprus.caseId}/lease-review`, {
            documentId: cyprus.link.documentId,
          })
        ).json().messageKey,
      ).toBe("leaseReviewNotApplicable");
    });

    it("keeps each firm's reviews to itself", async () => {
      const { lawyer, caseId, link } = await leaseholdCase("Private Lawyer");
      await clean(link.versionId);
      const review = (
        await lawyer.post(`/api/v1/cases/${caseId}/lease-review`, { documentId: link.documentId })
      ).json();
      const other = await leaseholdCase("Other Lawyer");
      expect(
        (await other.lawyer.get(`/api/v1/cases/${caseId}/lease-review`)).json().review,
      ).toBeNull();
      expect(
        (await other.lawyer.patch(`/api/v1/lease-reviews/${review.id}`, { report: "x" })).json()
          .messageKey,
      ).toBe("leaseReviewNotFound");
    });

    it("says when Kleidi Assist is not switched on", async () => {
      const { lawyer, caseId, link } = await leaseholdCase("Bare Lawyer", { server: bare });
      await clean(link.versionId);
      expect((await lawyer.get(`/api/v1/cases/${caseId}/lease-review`)).json()).toEqual({
        available: false,
        review: null,
      });
      expect(
        (
          await lawyer.post(`/api/v1/cases/${caseId}/lease-review`, { documentId: link.documentId })
        ).json().messageKey,
      ).toBe("assistUnavailable");
    });
  },
);
