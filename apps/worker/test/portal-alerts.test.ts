import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import type { Clock, StoredEvent } from "@kleidi/kernel";
import { openCase } from "@kleidi/modules/cases";
import { createFirm } from "@kleidi/modules/firms";
import { updateProfile } from "@kleidi/modules/identity";
import { postClientMessage, postFirmMessage } from "@kleidi/modules/messages";
import type { Notifier, OutboundMessage } from "@kleidi/modules/notifications";
import { addPayment } from "@kleidi/modules/payments";
import {
  inviteClient,
  revokeAccess,
  sendMessageAlert,
  sendPaymentAddedAlert,
  sendPaymentReminders,
} from "@kleidi/modules/portal";

const APP = "http://localhost:5180";
const at = (iso: string): Clock => ({ now: () => new Date(iso) });

// Integration: alerts to clients and lawyers, against the local Postgres.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "portal alerts",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    afterAll(async () => Promise.all([close(), admin.close()]));

    const sent: OutboundMessage[] = [];
    const notifier: Notifier = {
      async send(m) {
        sent.push(m);
        return { providerId: randomUUID() };
      },
    };
    const to = (address: string) => sent.filter((m) => m.to === address);
    // Kleidi stores phone numbers normalised, so texts are matched on the digits.
    const texts = (template: string) =>
      sent.filter(
        (m) =>
          m.channel === "sms" &&
          m.template === template &&
          m.to.replace(/\D/g, "") === "447700900456",
      );

    let ctx: {
      firm: { firmId: string; role: "firm_admin" };
      actor: { userId: string; name: string; email: string };
    };
    let caseId: string;
    let accessId: string;
    const buyerEmail = `james.${randomUUID().slice(0, 8)}@example.test`;
    const buyerPhone = "+44 7700 900456";

    beforeAll(async () => {
      const [user] = await admin.db
        .insert(schema.users)
        .values({
          name: "Elena Christou",
          email: `elena.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      ctx = {
        firm: { firmId: "", role: "firm_admin" },
        actor: { userId: user!.id, name: user!.name, email: user!.email },
      };
      ctx.firm.firmId = (await createFirm(db, { name: "Alerts & Co", actor: ctx.actor })).id;
      await updateProfile(db, user!.id, {
        locale: "en",
        phone: "+357 99 123456",
        smsReminders: true,
      });
      const opened = await openCase(db, {
        ...ctx,
        propertyAddress: "Flat A12, Peyia, Paphos",
        propertyType: "offplan",
        parties: [{ role: "buyer", fullName: "James Hart", email: buyerEmail, phone: buyerPhone }],
      });
      caseId = opened.id;
      const c = await admin.db
        .select()
        .from(schema.caseParties)
        .where(eq(schema.caseParties.caseId, caseId));
      await inviteClient(db, notifier, {
        ...ctx,
        caseId,
        partyId: c[0]!.id,
        locale: "ru",
        appUrl: APP,
      });
      const [access] = await admin.db
        .select()
        .from(schema.portalAccess)
        .where(eq(schema.portalAccess.caseId, caseId));
      accessId = access!.id;
    });

    /** The newest outbox event of a type for this case, as the worker would receive it. */
    async function lastEvent(type: string): Promise<StoredEvent> {
      const rows = await admin.db.select().from(schema.outbox).where(eq(schema.outbox.type, type));
      const row = rows.filter((r) => r.payload.entityId === caseId).at(-1)!;
      return { ...row, occurredAt: row.occurredAt.toISOString() } as StoredEvent;
    }

    it("emails and texts the client in their language when the lawyer writes, once", async () => {
      await postFirmMessage(db, { ...ctx, caseId, body: "The search is back." });
      const event = await lastEvent("messages.MessagePosted");
      const before = to(buyerEmail).length;
      await sendMessageAlert(db, notifier, event, APP);
      await sendMessageAlert(db, notifier, event, APP);

      const email = to(buyerEmail).slice(before);
      expect(email).toHaveLength(1);
      expect(email[0]).toMatchObject({
        channel: "email",
        template: "portal-message",
        locale: "ru",
      });
      expect(email[0]!.data).toMatchObject({ authorName: "Elena Christou", link: `${APP}/portal` });
      // The message itself never leaves Kleidi.
      expect(JSON.stringify(email[0])).not.toContain("The search is back.");
      expect(texts("portal-message-sms")).toHaveLength(1);
    });

    it("emails the assigned lawyer when the client writes", async () => {
      await postClientMessage(db, {
        firmId: ctx.firm.firmId,
        caseId,
        partyId: (
          await admin.db
            .select()
            .from(schema.portalAccess)
            .where(eq(schema.portalAccess.id, accessId))
        )[0]!.partyId,
        partyName: "James Hart",
        body: "Is the mortgage a problem?",
      });
      await sendMessageAlert(db, notifier, await lastEvent("messages.MessagePosted"), APP);
      const mail = to(ctx.actor.email).filter((m) => m.template === "client-message");
      expect(mail).toHaveLength(1);
      expect(mail[0]!.data).toMatchObject({
        clientName: "James Hart",
        link: `${APP}/cases/${caseId}`,
      });
      expect(JSON.stringify(mail[0])).not.toContain("mortgage a problem");
    });

    it("tells the client when a payment is added to their schedule", async () => {
      await addPayment(db, {
        ...ctx,
        caseId,
        label: "Deposit",
        amountMinor: 3000000,
        dueOn: "2027-02-15",
      });
      await sendPaymentAddedAlert(db, notifier, await lastEvent("payments.PaymentAdded"), APP);
      const mail = to(buyerEmail).filter((m) => m.template === "portal-payment-added");
      expect(mail).toHaveLength(1);
      expect(mail[0]!.data).toMatchObject({ label: "Deposit" });
      expect((mail[0]!.data as { amount: string }).amount).toMatch(/30[\s\u00a0.,]?000/);
    });

    it("reminds the client a week before and on the day, at 09:00 in the firm's time zone", async () => {
      const reminders = () => to(buyerEmail).filter((m) => m.template === "portal-payment-due");
      const dueTexts = () => texts("portal-payment-due-sms");

      // 08:00 in Nicosia (UTC+2 in February), a week before: too early.
      await sendPaymentReminders(db, notifier, APP, at("2027-02-08T06:00:00Z"), { atLocalHour: 9 });
      expect(reminders()).toHaveLength(0);
      // 09:00 in Nicosia, a week before.
      await sendPaymentReminders(db, notifier, APP, at("2027-02-08T07:00:00Z"), { atLocalHour: 9 });
      await sendPaymentReminders(db, notifier, APP, at("2027-02-08T07:00:00Z"), { atLocalHour: 9 });
      expect(reminders()).toHaveLength(1);
      expect(reminders()[0]!.data).toMatchObject({ when: "week", label: "Deposit" });
      expect(dueTexts()).toHaveLength(1);
      // On the day.
      await sendPaymentReminders(db, notifier, APP, at("2027-02-15T07:00:00Z"), { atLocalHour: 9 });
      expect(reminders().at(-1)!.data).toMatchObject({ when: "today" });
      expect(dueTexts()).toHaveLength(2);
    });

    it("stops alerting a client whose access was revoked", async () => {
      await revokeAccess(db, { ...ctx, accessId });
      const before = sent.length;
      await postFirmMessage(db, { ...ctx, caseId, body: "Anyone there?" });
      await sendMessageAlert(db, notifier, await lastEvent("messages.MessagePosted"), APP);
      expect(
        sent.slice(before).filter((m) => m.to === buyerEmail || m.to === buyerPhone),
      ).toHaveLength(0);
    });
  },
);
