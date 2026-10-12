import { and, desc, eq } from "drizzle-orm";
import { handleOnce, withFirm, type Db } from "@kleidi/db";
import { auditEvents } from "@kleidi/db/schema/audit";
import type { StoredEvent } from "@kleidi/kernel";
import { findUsersByIds } from "../identity/index.ts";

export const AUDIT_CONSUMER = "audit";

/**
 * Writes one append-only audit row per firm event. Every module's events reach the audit
 * trail through the outbox, so there is a single path for everything that changed.
 */
export async function recordAuditFromEvent(db: Db, event: StoredEvent): Promise<boolean> {
  if (!event.firmId) return false;
  // The invitation token is a secret: it never reaches the audit trail.
  const {
    entityType,
    entityId,
    token: _secret,
    ...rest
  } = event.payload as Record<string, unknown>;
  return withFirm(db, event.firmId, (tx) =>
    handleOnce(tx, AUDIT_CONSUMER, event.id, async () => {
      await tx.insert(auditEvents).values({
        firmId: event.firmId,
        actorUserId: event.actorUserId,
        action: event.type,
        entityType: typeof entityType === "string" ? entityType : "unknown",
        entityId: typeof entityId === "string" ? entityId : null,
        metadata: rest,
        eventId: event.id,
        eventPosition: event.position,
        createdAt: new Date(event.occurredAt),
      });
    }),
  );
}

/** The audit trail for one entity, oldest first, with who did each thing. */
export async function listForEntity(db: Db, firmId: string, entityType: string, entityId: string) {
  return withFirm(db, firmId, async (tx) => {
    const rows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
      // The newest 500 entries, returned oldest first.
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.eventPosition))
      .limit(500);
    rows.reverse();
    const actorIds = [...new Set(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
    const names = new Map((await findUsersByIds(tx, actorIds)).map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      ...r,
      actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
    }));
  });
}
