import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { idempotencyKeys } from "./schema/index.ts";

export const IDEMPOTENCY_TTL_HOURS = 24;

export type Claim =
  | { kind: "new"; id: string }
  | { kind: "replay"; statusCode: number; response: unknown }
  | { kind: "mismatch" }
  | { kind: "in_progress" };

/**
 * Claims a key for this user. The first request wins; repeats replay its stored response.
 * Expired keys are cleared first, so a key can be reused after the time-to-live.
 */
export async function claimIdempotencyKey(
  db: Db,
  userId: string,
  key: string,
  requestHash: string,
): Promise<Claim> {
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
        lt(
          idempotencyKeys.createdAt,
          sql`now() - make_interval(hours => ${IDEMPOTENCY_TTL_HOURS})`,
        ),
      ),
    );
  const [inserted] = await db
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id });
  if (inserted) return { kind: "new", id: inserted.id };

  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (!existing) return claimIdempotencyKey(db, userId, key, requestHash);
  if (existing.requestHash !== requestHash) return { kind: "mismatch" };
  if (existing.statusCode === null) return { kind: "in_progress" };
  return { kind: "replay", statusCode: existing.statusCode, response: existing.response };
}

export async function completeIdempotencyKey(
  db: Db,
  id: string,
  statusCode: number,
  response: unknown,
): Promise<void> {
  await db.update(idempotencyKeys).set({ statusCode, response }).where(eq(idempotencyKeys.id, id));
}

/** Frees a key after a failed request, so the client can retry with the same key. */
export async function releaseIdempotencyKey(db: Db, id: string): Promise<void> {
  await db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
}
