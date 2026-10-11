import { handleOnce, withFirm, type Db } from "@kleidi/db";
import { auditEvents } from "@kleidi/db/schema/audit";
import type { StoredEvent } from "@kleidi/kernel";

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
        createdAt: new Date(event.occurredAt),
      });
    }),
  );
}
