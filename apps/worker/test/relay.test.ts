import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, schema, withFirm } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import type { ObjectStore } from "@kleidi/modules/documents";
import { createFirm, inviteMember } from "@kleidi/modules/firms";
import type { Notifier, OutboundMessage } from "@kleidi/modules/notifications";
import { buildConsumers } from "../src/consumers.ts";
import { relayToConsumers } from "../src/relay.ts";

// Integration: needs the local Postgres, migrated and seeded.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)(
  "outbox relay",
  () => {
    const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
    const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
    afterAll(async () => Promise.all([close(), admin.close()]));

    const sent: OutboundMessage[] = [];
    const notifier: Notifier = { send: async (m) => (sent.push(m), { providerId: randomUUID() }) };
    const consumers = buildConsumers({
      db,
      notifier,
      appUrl: "http://localhost:5180",
      store: {} as ObjectStore,
      scanner: { scan: async () => ({ clean: true }) },
    });

    it("delivers each event to its consumers exactly once", async () => {
      const [user] = await admin.db
        .insert(schema.users)
        .values({
          name: "Elena Christou",
          email: `elena.${randomUUID().slice(0, 8)}@example.test`,
          twoFactorEnabled: true,
        })
        .returning();
      const actor = { userId: user!.id, name: user!.name, email: user!.email };
      const firm = await createFirm(db, { name: "Relay Test & Co", actor });
      const invitee = `andreas.${randomUUID().slice(0, 8)}@example.test`;
      await inviteMember(db, {
        firm: { firmId: firm.id, role: "firm_admin" },
        actor,
        email: invitee,
        role: "lawyer",
      });

      // Relay with direct delivery instead of pg-boss; deliver twice to prove consumers are idempotent.
      const delivered: StoredEvent[] = [];
      let relayed = 0;
      for (let i = 0; i < 10; i++) {
        const n = await relayToConsumers(db, consumers, async (consumer, event) => {
          delivered.push(event);
          await consumer.handle(event);
          await consumer.handle(event);
        });
        relayed += n;
        if (n === 0) break;
      }
      const ours = delivered.filter((e) => e.firmId === firm.id);
      expect(ours.map((e) => e.type)).toEqual(
        expect.arrayContaining(["firms.FirmCreated", "firms.MemberInvited"]),
      );
      expect(relayed).toBeGreaterThanOrEqual(2);

      const audit = await withFirm(db, firm.id, (tx) => tx.select().from(schema.auditEvents));
      expect(audit.map((a) => a.action).sort()).toEqual([
        "firms.FirmCreated",
        "firms.MemberInvited",
      ]);
      expect(audit.every((a) => !("token" in a.metadata))).toBe(true);

      const emails = sent.filter((m) => m.to === invitee);
      expect(emails).toHaveLength(1);
      expect(emails[0]!.data.link).toMatch(/^http:\/\/localhost:5180\/invite\//);
      const [notification] = await withFirm(db, firm.id, (tx) =>
        tx
          .select()
          .from(schema.notifications)
          .where(and(eq(schema.notifications.recipient, invitee))),
      );
      expect(notification?.status).toBe("sent");

      const unpublished = await admin.db
        .select()
        .from(schema.outbox)
        .where(
          inArray(
            schema.outbox.id,
            ours.map((e) => e.id),
          ),
        );
      expect(unpublished.every((row) => row.publishedAt !== null)).toBe(true);
    });
  },
);
