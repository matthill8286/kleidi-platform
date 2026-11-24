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

const EXPLANATION = {
  document_type: "land_registry_search",
  title_status: "trapped",
  plain_english_summary: "The developer still owns the land and it is mortgaged.",
};

// Integration: what a buyer can do in the portal, and what the firm sees of it.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "buyer portal",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    const store = testStore();
    const assistCalls: Parameters<Assist["explainCyprus"]>[0][] = [];
    const assist: Assist = {
      async explainCyprus(input) {
        assistCalls.push(input);
        return { explanation: EXPLANATION, markdown: "# Explained", model: "gpt-test" };
      },
      async reviewLease() {
        throw new Error("Not used in these tests");
      },
      async translate() {
        throw new Error("Not used in these tests");
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
      // Setup may fail before the apps exist; close what was built.
      await Promise.all([app?.close(), bare?.close()]);
      await Promise.all([close(), admin.close()]);
    });

    /** A Cyprus firm with one case, one buyer signed in to the portal, and one shared file. */
    async function buyerOnCase(name: string, server = app) {
      const { c: lawyer } = await enrolledUser(server, name);
      lawyer.useFirm((await lawyer.post("/api/v1/firms", { name: `${name} Law` })).json().id);
      const buyerEmail = uniqueEmail("buyer");
      const created = (
        await lawyer.post("/api/v1/cases", {
          propertyAddress: "Flat A12, Peyia, Paphos",
          propertyType: "offplan",
          parties: [{ role: "buyer", fullName: "James Hart", email: buyerEmail }],
        })
      ).json();
      const buyer = created.parties[0];
      await lawyer.patch(`/api/v1/cases/${created.id}/parties/${buyer.id}`, {
        phone: "+44 7700 900123",
      });

      async function firmFile(title: string, shared: boolean, type = "application/pdf") {
        const body = Buffer.from(`${title} contents`);
        const link = (
          await lawyer.post(`/api/v1/cases/${created.id}/documents/uploads`, {
            title,
            fileName: `${title}.pdf`,
            mimeType: type,
            byteSize: body.length,
          })
        ).json();
        await fetch(link.uploadUrl, { method: "PUT", headers: link.uploadHeaders, body });
        await lawyer.post(`/api/v1/documents/versions/${link.versionId}/complete`);
        await admin.db
          .update(schema.documentVersions)
          .set({ scanStatus: "clean", review: "accepted" })
          .where(eq(schema.documentVersions.id, link.versionId));
        if (shared)
          await lawyer.patch(`/api/v1/documents/${link.documentId}`, { visibility: "client" });
        return { ...link, body } as { documentId: string; versionId: string; body: Buffer };
      }
      const shared = await firmFile("Land Registry search", true);
      const internal = await firmFile("Internal note", false);

      await lawyer.post(`/api/v1/cases/${created.id}/parties/${buyer.id}/portal`, { locale: "en" });
      const invite = sentMessages.filter((m) => m.to === buyerEmail).at(-1)!;
      const token = (invite.data as { link: string }).link.split("/portal/link/")[1]!;
      const portal = client(server);
      await portal.post(`/api/portal/link/${token}/start`, {});
      const code = (
        sentMessages.filter((m) => m.channel === "sms").at(-1)!.data as { code: string }
      ).code;
      await portal.post(`/api/portal/link/${token}/verify`, { code });
      await portal.post("/api/portal/privacy/accept", {});
      return { lawyer, portal, caseId: created.id as string, shared, internal };
    }

    describe("English explanations", () => {
      it("lets the buyer explain a shared document, and keeps it to that buyer", async () => {
        const { lawyer, portal, caseId, shared } = await buyerOnCase("Explain Lawyer");
        expect((await portal.get("/api/portal/case")).json().features).toEqual({ explain: true });

        const res = await portal.post(`/api/portal/documents/${shared.versionId}/explanations`, {
          question: "Can I get my title deed?",
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({
          documentTitle: "Land Registry search",
          question: "Can I get my title deed?",
          result: EXPLANATION,
        });
        expect(assistCalls.at(-1)).toEqual({
          document: {
            name: "Land Registry search.pdf",
            mediaType: "application/pdf",
            bytes: shared.body,
          },
          question: "Can I get my title deed?",
        });

        const view = (await portal.get("/api/portal/case")).json();
        expect(view.explanations).toEqual([
          expect.objectContaining({ documentTitle: "Land Registry search" }),
        ]);

        // The firm has no view of explanations, only the activity entry, and no explain action.
        expect((await lawyer.get(`/api/v1/cases/${caseId}/explanations`)).statusCode).toBe(404);
        // The lawyer's workspace has no explain action.
        expect(
          (await lawyer.post(`/api/v1/documents/versions/${shared.versionId}/explanations`, {}))
            .statusCode,
        ).toBe(404);
      });

      it("refuses documents the buyer cannot see", async () => {
        const { portal, internal } = await buyerOnCase("Private Lawyer");
        const res = await portal.post(
          `/api/portal/documents/${internal.versionId}/explanations`,
          {},
        );
        expect(res.statusCode).toBe(404);
      });

      it("caps explanations per case to keep the AI cost inside the per-sale price", async () => {
        const { portal, shared } = await buyerOnCase("Capped Lawyer");
        for (let i = 0; i < 25; i++) {
          expect(
            (await portal.post(`/api/portal/documents/${shared.versionId}/explanations`, {}))
              .statusCode,
          ).toBe(201);
        }
        const over = await portal.post(
          `/api/portal/documents/${shared.versionId}/explanations`,
          {},
        );
        expect(over.statusCode).toBe(422);
        expect(over.json()).toMatchObject({ messageKey: "explanationLimit" });
      }, 60_000);

      it("switches the feature off when Kleidi Assist is not configured", async () => {
        const { portal, shared } = await buyerOnCase("Offline Lawyer", bare);
        expect((await portal.get("/api/portal/case")).json().features).toEqual({ explain: false });
        const res = await portal.post(`/api/portal/documents/${shared.versionId}/explanations`, {});
        expect(res.statusCode).toBe(503);
      });
    });

    describe("messages", () => {
      it("keeps one thread per case between the buyer and the firm", async () => {
        const { lawyer, portal, caseId } = await buyerOnCase("Thread Lawyer");
        const sent = await lawyer.post(`/api/v1/cases/${caseId}/messages`, {
          body: "The search is back. See the explanation.",
        });
        expect(sent.statusCode).toBe(201);
        expect((await portal.post("/api/portal/messages", { body: "  " })).statusCode).toBe(422);
        expect(
          (
            await portal.post("/api/portal/messages", {
              body: "Thanks. Is the mortgage a problem?",
            })
          ).statusCode,
        ).toBe(201);

        const firmView = (await lawyer.get(`/api/v1/cases/${caseId}/messages`)).json();
        expect(
          firmView.map((m: { author: { kind: string; name: string }; body: string }) => [
            m.author.kind,
            m.author.name,
            m.body,
          ]),
        ).toEqual([
          ["firm", "Thread Lawyer", "The search is back. See the explanation."],
          ["client", "James Hart", "Thanks. Is the mortgage a problem?"],
        ]);
        const buyerView = (await portal.get("/api/portal/case")).json().messages;
        expect(buyerView).toHaveLength(2);
        expect(buyerView[0]).toMatchObject({ author: { kind: "firm", name: "Thread Lawyer" } });
      });

      it("keeps other firms out of the thread", async () => {
        const { caseId } = await buyerOnCase("Owner Lawyer");
        const { lawyer: outsider } = await buyerOnCase("Outsider Lawyer");
        expect((await outsider.get(`/api/v1/cases/${caseId}/messages`)).statusCode).toBe(404);
        expect(
          (await outsider.post(`/api/v1/cases/${caseId}/messages`, { body: "hi" })).statusCode,
        ).toBe(404);
      });
    });

    describe("payment schedule", () => {
      it("lets the firm keep the schedule and shows it to the buyer", async () => {
        const { lawyer, portal, caseId } = await buyerOnCase("Payments Lawyer");
        const first = await lawyer.post(`/api/v1/cases/${caseId}/payments`, {
          label: "Deposit",
          amountMinor: 3000000,
          dueOn: "2026-12-01",
          payTo: "Developer's account, details in the contract",
        });
        expect(first.statusCode).toBe(201);
        expect(first.json()).toMatchObject({ currency: "EUR", status: "due" });
        await lawyer.post(`/api/v1/cases/${caseId}/payments`, {
          label: "Second instalment",
          amountMinor: 9000000,
          dueOn: "2027-03-01",
        });
        expect(
          (await lawyer.post(`/api/v1/cases/${caseId}/payments`, { label: "Bad", amountMinor: 0 }))
            .statusCode,
        ).toBe(422);

        const paid = await lawyer.patch(`/api/v1/payments/${first.json().id}`, {
          status: "paid",
          paidOn: "2026-11-28",
        });
        expect(paid.statusCode).toBe(200);

        const schedule = (await portal.get("/api/portal/case")).json().payments;
        expect(
          schedule.map((p: { label: string; status: string; amountMinor: number }) => [
            p.label,
            p.status,
            p.amountMinor,
          ]),
        ).toEqual([
          ["Deposit", "paid", 3000000],
          ["Second instalment", "due", 9000000],
        ]);

        const second = (await lawyer.get(`/api/v1/cases/${caseId}/payments`)).json()[1];
        expect((await lawyer.delete(`/api/v1/payments/${second.id}`)).statusCode).toBe(204);
        expect((await portal.get("/api/portal/case")).json().payments).toHaveLength(1);
      });

      it("keeps other firms away from the schedule", async () => {
        const { lawyer, caseId } = await buyerOnCase("Ledger Lawyer");
        const id = (
          await lawyer.post(`/api/v1/cases/${caseId}/payments`, {
            label: "Deposit",
            amountMinor: 100,
          })
        ).json().id;
        const { lawyer: outsider } = await buyerOnCase("Snoop Lawyer");
        expect((await outsider.get(`/api/v1/cases/${caseId}/payments`)).statusCode).toBe(404);
        expect(
          (await outsider.patch(`/api/v1/payments/${id}`, { status: "paid" })).statusCode,
        ).toBe(404);
      });
    });

    describe("next steps", () => {
      it("tells the buyer in plain English what is happening and what to do", async () => {
        const { lawyer, portal, caseId } = await buyerOnCase("Guide Lawyer");
        const steps = (await portal.get("/api/portal/case")).json().nextSteps;
        expect(steps.stageKey).toBe("reservation");
        expect(steps.now.en).toMatch(/reserved the property/);
        expect(steps.action.en).toMatch(/passport/);

        await lawyer.post(
          `/api/v1/cases/${caseId}/transitions`,
          { kind: "advance" },
          { "if-match": '"v1"' },
        );
        const next = (await portal.get("/api/portal/case")).json().nextSteps;
        expect(next.stageKey).toBe("due_diligence");
        expect(next.now.en).toMatch(/Land Registry/);
      });
    });
  },
);
