import { and, asc, eq, gt, isNull, lte, type SQL } from "drizzle-orm";
import { publishEvents, withFirm, type Db, type Tx } from "@kleidi/db";
import { deadlines } from "@kleidi/db/schema/deadlines";
import { AppError, systemClock, type Clock, type DomainEvent } from "@kleidi/kernel";
import { findCase, findCasesByIds } from "../cases/index.ts";
import { getMembership, listFirmIds, type Actor, type FirmContext } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import type {
  DeadlineAdded,
  DeadlineChanged,
  DeadlineCompleted,
  DeadlineRemoved,
  DeadlineReopened,
  ReminderDue,
} from "./events.ts";
import { cleanReminders, dueReminderOffsets, urgency } from "./reminders.ts";

const LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
type Row = typeof deadlines.$inferSelect;

const onCase = (d: Pick<Row, "id" | "caseId" | "title">) => ({
  entityType: "case" as const,
  entityId: d.caseId,
  deadlineId: d.id,
  title: d.title,
});

async function ownerInFirm(db: Db, firmId: string, ownerId: string) {
  if (!(await getMembership(db, ownerId, firmId))) {
    throw new AppError("invalid", "The owner is not in this firm", "ownerNotInFirm");
  }
}

/** Loads a deadline for a change. Deadlines on completed or cancelled cases are read-only. */
async function loadDeadline(tx: Tx, id: string) {
  const [row] = await tx.select().from(deadlines).where(eq(deadlines.id, id)).for("update");
  if (!row) throw new AppError("not_found", "Deadline not found", "deadlineNotFound");
  const c = await findCase(tx, row.caseId);
  if (c && (c.status === "completed" || c.status === "cancelled")) {
    throw new AppError("invalid", `A ${c.status} case cannot change`, "caseClosed", {
      status: c.status,
    });
  }
  return row;
}

export async function addDeadline(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    title: string;
    dueAt: Date;
    ownerId?: string | undefined;
    remindBeforeHours?: number[] | undefined;
    notes?: string | undefined;
  },
  clock: Clock = systemClock,
) {
  const title = input.title.trim();
  if (title.length < 2) throw new AppError("invalid", "Give the deadline a title", "deadlineTitle");
  if (input.dueAt <= clock.now()) {
    throw new AppError("invalid", "The deadline must be in the future", "deadlinePast");
  }
  const ownerId = input.ownerId ?? input.actor.userId;
  await ownerInFirm(db, input.firm.firmId, ownerId);

  return withFirm(db, input.firm.firmId, async (tx) => {
    const c = await findCase(tx, input.caseId);
    if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
    if (c.status === "cancelled" || c.status === "completed") {
      throw new AppError("invalid", `A ${c.status} case cannot change`, "caseClosed", {
        status: c.status,
      });
    }
    const [row] = await tx
      .insert(deadlines)
      .values({
        firmId: input.firm.firmId,
        caseId: c.id,
        title,
        notes: input.notes?.trim() || null,
        dueAt: input.dueAt,
        ownerId,
        remindBeforeHours: cleanReminders(input.remindBeforeHours ?? [72, 24]),
        createdById: input.actor.userId,
      })
      .returning();
    const added: DeadlineAdded = {
      type: "deadlines.DeadlineAdded",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: { ...onCase(row!), dueAt: row!.dueAt.toISOString(), ownerId },
    };
    await publishEvents(tx, [added]);
    return row!;
  });
}

/** Reschedules or reassigns. A new due date restarts the reminders for it. */
export async function changeDeadline(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    deadlineId: string;
    title?: string | undefined;
    dueAt?: Date | undefined;
    ownerId?: string | undefined;
    remindBeforeHours?: number[] | undefined;
    notes?: string | null | undefined;
  },
  clock: Clock = systemClock,
) {
  if (input.ownerId) await ownerInFirm(db, input.firm.firmId, input.ownerId);
  if (input.dueAt && input.dueAt <= clock.now()) {
    throw new AppError("invalid", "The deadline must be in the future", "deadlinePast");
  }
  return withFirm(db, input.firm.firmId, async (tx) => {
    const current = await loadDeadline(tx, input.deadlineId);
    const rescheduled = input.dueAt && input.dueAt.getTime() !== current.dueAt.getTime();
    const [row] = await tx
      .update(deadlines)
      .set({
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.notes === undefined ? {} : { notes: input.notes?.trim() || null }),
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        ...(input.remindBeforeHours
          ? { remindBeforeHours: cleanReminders(input.remindBeforeHours) }
          : {}),
        ...(rescheduled ? { dueAt: input.dueAt, remindersSent: [] } : {}),
        updatedAt: clock.now(),
      })
      .where(eq(deadlines.id, current.id))
      .returning();
    const changed: DeadlineChanged = {
      type: "deadlines.DeadlineChanged",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        ...onCase(row!),
        ...(rescheduled ? { dueAt: row!.dueAt.toISOString() } : {}),
        ...(input.ownerId && input.ownerId !== current.ownerId ? { ownerId: input.ownerId } : {}),
      },
    };
    await publishEvents(tx, [changed]);
    return row!;
  });
}

export async function setDeadlineDone(
  db: Db,
  input: { firm: FirmContext; actor: Actor; deadlineId: string; done: boolean },
  clock: Clock = systemClock,
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const current = await loadDeadline(tx, input.deadlineId);
    if (Boolean(current.completedAt) === input.done) return current;
    const [row] = await tx
      .update(deadlines)
      .set(
        input.done
          ? { completedAt: clock.now(), completedById: input.actor.userId, updatedAt: clock.now() }
          : { completedAt: null, completedById: null, updatedAt: clock.now() },
      )
      .where(eq(deadlines.id, current.id))
      .returning();
    const base = {
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: onCase(row!),
    };
    const event: DeadlineCompleted | DeadlineReopened = input.done
      ? { ...base, type: "deadlines.DeadlineCompleted" }
      : { ...base, type: "deadlines.DeadlineReopened" };
    await publishEvents(tx, [event]);
    return row!;
  });
}

export async function removeDeadline(
  db: Db,
  input: { firm: FirmContext; actor: Actor; deadlineId: string },
) {
  await withFirm(db, input.firm.firmId, async (tx) => {
    const current = await loadDeadline(tx, input.deadlineId);
    await tx.delete(deadlines).where(eq(deadlines.id, current.id));
    const removed: DeadlineRemoved = {
      type: "deadlines.DeadlineRemoved",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: onCase(current),
    };
    await publishEvents(tx, [removed]);
  });
}

/** Deadlines with their case and owner, open ones soonest first, then finished ones. */
export async function listDeadlines(
  db: Db,
  firmId: string,
  filter: {
    caseId?: string | undefined;
    ownerId?: string | undefined;
    includeDone?: boolean | undefined;
  },
  clock: Clock = systemClock,
) {
  const now = clock.now();
  const where: SQL[] = [];
  if (filter.caseId) where.push(eq(deadlines.caseId, filter.caseId));
  if (filter.ownerId) where.push(eq(deadlines.ownerId, filter.ownerId));
  if (!filter.includeDone) where.push(isNull(deadlines.completedAt));

  const { rows, caseRows } = await withFirm(db, firmId, async (tx) => {
    const rows = await tx
      .select()
      .from(deadlines)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(deadlines.dueAt))
      // A firm's deadline list stays bounded; finished ones beyond this are history.
      .limit(500);
    const caseRows = await findCasesByIds(tx, [...new Set(rows.map((r) => r.caseId))]);
    return { rows, caseRows };
  });
  const owners = new Map(
    (
      await findUsersByIds(db, [...new Set(rows.flatMap((r) => (r.ownerId ? [r.ownerId] : [])))])
    ).map((u) => [u.id, u.name]),
  );
  const byCase = new Map(caseRows.map((c) => [c.id, c]));
  const items = rows.map((r) => ({
    id: r.id,
    caseId: r.caseId,
    caseReference: byCase.get(r.caseId)?.reference ?? "",
    propertyAddress: byCase.get(r.caseId)?.propertyAddress ?? null,
    title: r.title,
    notes: r.notes,
    dueAt: r.dueAt,
    owner: r.ownerId ? { id: r.ownerId, name: owners.get(r.ownerId) ?? "" } : null,
    remindBeforeHours: r.remindBeforeHours,
    completedAt: r.completedAt,
    urgency: urgency(r, now),
  }));
  // Open deadlines first by due date, then finished ones, most recent first.
  return [
    ...items.filter((i) => !i.completedAt),
    ...items
      .filter((i) => i.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime()),
  ];
}

/**
 * Announces each reminder whose time has come. The sent offsets are saved in the same
 * transaction as the outbox event, so a worker that restarts never announces one twice.
 */
export async function announceDueReminders(db: Db, clock: Clock = systemClock): Promise<number> {
  const now = clock.now();
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

      const events: DomainEvent[] = [];
      for (const deadline of upcoming) {
        if (!deadline.ownerId) continue;
        const offsets = dueReminderOffsets(deadline, deadline.remindersSent, now);
        if (offsets.length === 0) continue;
        await tx
          .update(deadlines)
          .set({ remindersSent: [...deadline.remindersSent, ...offsets] })
          .where(eq(deadlines.id, deadline.id));
        // One message for the nearest window, even when several opened at once.
        const due: ReminderDue = {
          type: "deadlines.ReminderDue",
          firmId,
          actorUserId: null,
          payload: {
            ...onCase(deadline),
            caseId: deadline.caseId,
            dueAt: deadline.dueAt.toISOString(),
            ownerId: deadline.ownerId,
            hoursBefore: Math.min(...offsets),
          },
        };
        events.push(due);
      }
      await publishEvents(tx, events);
      return events.length;
    });
  }
  return announced;
}
