import { and, asc, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DomainEvent, StoredEvent } from "@kleidi/kernel";
import type { Db, Tx } from "./client.ts";
import { idempotencyKeys, outbox, processedEvents } from "./schema/index.ts";

/** Stores events in the outbox inside the caller's transaction, so they commit with the change. */
export async function publishEvents(tx: Tx, events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  await tx.insert(outbox).values(
    events.map((e) => ({
      type: e.type,
      firmId: e.firmId,
      actorUserId: e.actorUserId,
      payload: e.payload,
    })),
  );
}

/**
 * Claims up to `limit` unpublished events, hands them to `send`, then marks them published.
 * SKIP LOCKED lets several relays run without sending an event twice.
 */
export async function relayOutbox(
  db: Db,
  send: (event: StoredEvent) => Promise<void>,
  limit = 50,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(isNull(outbox.publishedAt))
      .orderBy(asc(outbox.position))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await send({
        id: row.id,
        position: row.position,
        type: row.type,
        firmId: row.firmId,
        actorUserId: row.actorUserId,
        payload: row.payload,
        occurredAt: row.occurredAt.toISOString(),
      });
    }
    if (rows.length > 0) {
      await tx
        .update(outbox)
        .set({ publishedAt: sql`now()`, attempts: sql`${outbox.attempts} + 1` })
        .where(
          and(
            inArray(
              outbox.id,
              rows.map((r) => r.id),
            ),
          ),
        );
    }
    return rows.length;
  });
}

/**
 * Runs a consumer's side effects at most once per event. Returns false when the event was
 * already handled, so at-least-once delivery is safe to retry.
 */
export async function handleOnce(
  tx: Tx,
  consumer: string,
  eventId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const claimed = await tx
    .insert(processedEvents)
    .values({ consumer, eventId })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  if (claimed.length === 0) return false;
  await fn();
  return true;
}

/**
 * Deletes what is no longer needed: events relayed more than a week ago, which may hold
 * invitation tokens, and idempotency responses past their 24 hours.
 */
export async function purgeExpired(db: Db): Promise<{ events: number; keys: number }> {
  const events = await db
    .delete(outbox)
    .where(lt(outbox.publishedAt, sql`now() - interval '7 days'`))
    .returning({ id: outbox.id });
  const keys = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, sql`now() - interval '24 hours'`))
    .returning({ id: idempotencyKeys.id });
  return { events: events.length, keys: keys.length };
}
