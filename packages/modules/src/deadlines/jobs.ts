import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { deadlines } from "@kleidi/db/schema/deadlines";
import type { DomainEvent } from "@kleidi/kernel";
import { listFirmIds } from "../firms/index.ts";
import { dueReminderOffsets } from "./reminders.ts";

const LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export type ReminderDue = DomainEvent<
  "deadlines.ReminderDue",
  {
    entityType: "deadline";
    entityId: string;
    caseId: string;
    title: string;
    dueAt: string;
    ownerId: string;
    hoursBefore: number;
  }
>;

/**
 * Announces each reminder whose time has come. Runs firm by firm so row-level security
 * applies; the notifications module sends the message.
 */
export async function announceDueReminders(db: Db, now = new Date()): Promise<number> {
  let announced = 0;
  for (const firmId of await listFirmIds(db)) {
    announced += await withFirm(db, firmId, async (tx) => {
      const upcoming = await tx
        .select()
        .from(deadlines)
        .where(
          and(
            isNull(deadlines.completedAt),
            gt(deadlines.dueAt, now),
            lte(deadlines.dueAt, new Date(now.getTime() + LOOKAHEAD_MS)),
          ),
        )
        .for("update", { skipLocked: true });

      let count = 0;
      for (const deadline of upcoming) {
        if (!deadline.ownerId) continue;
        const offsets = dueReminderOffsets(deadline, deadline.remindersSent, now);
        if (offsets.length === 0) continue;
        await tx
          .update(deadlines)
          .set({ remindersSent: [...deadline.remindersSent, ...offsets] })
          .where(eq(deadlines.id, deadline.id));
        // One message for the nearest window, even when several opened at once.
        const event: ReminderDue = {
          type: "deadlines.ReminderDue",
          firmId,
          actorUserId: null,
          payload: {
            entityType: "deadline",
            entityId: deadline.id,
            caseId: deadline.caseId,
            title: deadline.title,
            dueAt: deadline.dueAt.toISOString(),
            ownerId: deadline.ownerId,
            hoursBefore: Math.min(...offsets),
          },
        };
        await publishEvents(tx, [event]);
        count += 1;
      }
      return count;
    });
  }
  return announced;
}
