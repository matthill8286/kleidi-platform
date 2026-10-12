import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import type { Clock, StoredEvent } from "@kleidi/kernel";
import { openCase } from "@kleidi/modules/cases";
import { addDeadline, announceDueReminders } from "@kleidi/modules/deadlines";
import { createFirm } from "@kleidi/modules/firms";
import { updateProfile } from "@kleidi/modules/identity";
import {
  renderMessage,
  sendDailyDigests,
  sendDeadlineReminder,
  type Notifier,
  type OutboundMessage,
} from "@kleidi/modules/notifications";

const HOUR = 60 * 60 * 1000;
const APP = "http://localhost:5180";

// Integration: reminders against the local Postgres, with a notifier that records messages.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "deadline reminders",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    afterAll(async () => Promise.all([close(), admin.close()]));

    const sent: OutboundMessage[] = [];
    let failNextSms = false;
    const notifier: Notifier = {
      async send(m) {
        if (m.channel === "sms" && failNextSms) {
          failNextSms = false;
          throw new Error("SMS provider down");
        }
        sent.push(m);
        return { providerId: randomUUID() };
      },
    };

    let ctx: {
      firm: { firmId: string; role: "firm_admin" };
      actor: { userId: string; name: string; email: string };
    };
    let caseId: string;

    beforeAll(async () => {
      const [user] = await admin.db
        .insert(schema.users)
        .values({
          name: "Eleni Pappa",
          email: `eleni.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      ctx = {
        firm: { firmId: "", role: "firm_admin" },
        actor: { userId: user!.id, name: user!.name, email: user!.email },
      };
      const firm = await createFirm(db, { name: "Reminder Test & Co", actor: ctx.actor });
      ctx.firm.firmId = firm.id;
      // A Greek-speaking lawyer who wants SMS for the last day.
      await updateProfile(db, user!.id, {
        locale: "el",
        phone: "+357 99 123456",
        smsReminders: true,
      });
      caseId = (
        await openCase(db, {
          ...ctx,
          propertyAddress: "5 Grivas Digenis, Paphos",
          propertyType: "resale",
          parties: [{ role: "buyer", fullName: "Ivan Petrov" }],
        })
      ).id;
    });

    async function reminderEvents(deadlineId: string): Promise<StoredEvent[]> {
      const rows = await admin.db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.type, "deadlines.ReminderDue"));
      return rows
        .filter((r) => r.payload.deadlineId === deadlineId)
        .map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
    }

    it("announces each reminder once, however often the job runs", async () => {
      const deadline = await addDeadline(db, {
        ...ctx,
        caseId,
        title: "Pay stamp duty",
        dueAt: new Date(Date.now() + 20 * HOUR),
      });
      // Due in 20 hours: the 72 and 24 hour windows are both open, so one reminder covers both.
      expect(await announceDueReminders(db)).toBeGreaterThanOrEqual(1);
      await announceDueReminders(db); // a second run, as after a worker restart
      const events = await reminderEvents(deadline.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload.hoursBefore).toBe(24);
    });

    it("emails and texts the owner in Greek exactly once, even across retries", async () => {
      const deadline = await addDeadline(db, {
        ...ctx,
        caseId,
        title: "Sign the sale contract",
        dueAt: new Date(Date.now() + 10 * HOUR),
      });
      await announceDueReminders(db);
      const [event] = await reminderEvents(deadline.id);
      const ours = () =>
        sent.filter((m) => "title" in m.data && m.data.title === "Sign the sale contract");

      // The SMS provider fails after the email went out; the job throws and is retried.
      failNextSms = true;
      await expect(sendDeadlineReminder(db, notifier, event!, APP)).rejects.toThrow(
        /SMS provider down/,
      );
      await sendDeadlineReminder(db, notifier, event!, APP);
      await sendDeadlineReminder(db, notifier, event!, APP); // a duplicate delivery

      expect(
        ours()
          .map((m) => m.channel)
          .sort(),
      ).toEqual(["email", "sms"]);
      const email = ours().find((m) => m.channel === "email")!;
      expect(renderMessage(email).subject).toMatch(
        /^Υπενθύμιση: Sign the sale contract \(CY-\d{4}-\d{3}\)/,
      );
      expect(ours().find((m) => m.channel === "sms")!.to).toBe("+35799123456");
    });

    it("sends one morning digest per member per day", async () => {
      const before = sent.filter((m) => m.template === "daily-digest").length;
      await sendDailyDigests(db, notifier, APP);
      await sendDailyDigests(db, notifier, APP);
      const digests = sent.filter((m) => m.template === "daily-digest" && m.to === ctx.actor.email);
      expect(
        sent.filter((m) => m.template === "daily-digest").length - before,
      ).toBeGreaterThanOrEqual(1);
      expect(digests).toHaveLength(1);
      expect(digests[0]!.locale).toBe("el");
      // The digest visits every firm in the shared test database.
    }, 60_000);

    it("skips the digest for a member with nothing due", async () => {
      // A day later in the clock's eyes, the deadlines are still open, so a digest goes again;
      // a firm with no deadlines and no flagged documents sends nothing.
      const [quiet] = await admin.db
        .insert(schema.users)
        .values({
          name: "Quiet Lawyer",
          email: `quiet.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      await createFirm(db, {
        name: "Quiet Firm",
        actor: { userId: quiet!.id, name: quiet!.name, email: quiet!.email },
      });
      const tomorrow: Clock = { now: () => new Date(Date.now() + 24 * HOUR) };
      await sendDailyDigests(db, notifier, APP, tomorrow);
      expect(sent.some((m) => m.template === "daily-digest" && m.to === quiet!.email)).toBe(false);
    }, 60_000);
  },
);
