import { and, eq, isNull } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { consents } from "@kleidi/db/schema/consent";
import { AppError, systemClock, type Clock } from "@kleidi/kernel";

export type Grantor = { firmId: string; caseId: string; partyId: string };
export type GranteeType = "agent" | "bank" | "insurer";

/** The client's sharing choices for their case, newest first, including revoked ones. */
export async function listConsents(db: Db, grantor: Grantor) {
  return withFirm(db, grantor.firmId, (tx) =>
    tx
      .select({
        id: consents.id,
        granteeType: consents.granteeType,
        granteeRef: consents.granteeRef,
        scope: consents.scope,
        grantedAt: consents.grantedAt,
        revokedAt: consents.revokedAt,
      })
      .from(consents)
      .where(
        and(eq(consents.caseId, grantor.caseId), eq(consents.grantorPartyId, grantor.partyId)),
      ),
  );
}

/** Records a client's permission for their agent, bank or insurer to see the case status. */
export async function grantConsent(
  db: Db,
  grantor: Grantor,
  grantee: { type: GranteeType; email: string },
  clock: Clock = systemClock,
) {
  const email = grantee.email.trim().toLowerCase();
  return withFirm(db, grantor.firmId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(consents)
      .where(
        and(
          eq(consents.caseId, grantor.caseId),
          eq(consents.grantorPartyId, grantor.partyId),
          eq(consents.granteeType, grantee.type),
          eq(consents.granteeRef, email),
          isNull(consents.revokedAt),
        ),
      );
    if (existing) return existing;
    const [row] = await tx
      .insert(consents)
      .values({
        firmId: grantor.firmId,
        caseId: grantor.caseId,
        grantorPartyId: grantor.partyId,
        granteeType: grantee.type,
        granteeRef: email,
        scope: "status",
        grantedAt: clock.now(),
      })
      .returning();
    await publishEvents(tx, [
      {
        type: "consent.Granted",
        firmId: grantor.firmId,
        actorUserId: null,
        payload: {
          entityType: "case",
          entityId: grantor.caseId,
          granteeType: grantee.type,
          granteeRef: email,
        },
      },
    ]);
    return row!;
  });
}

export async function revokeConsent(
  db: Db,
  grantor: Grantor,
  consentId: string,
  clock: Clock = systemClock,
) {
  await withFirm(db, grantor.firmId, async (tx) => {
    const [row] = await tx
      .update(consents)
      .set({ revokedAt: clock.now() })
      .where(
        and(
          eq(consents.id, consentId),
          eq(consents.grantorPartyId, grantor.partyId),
          isNull(consents.revokedAt),
        ),
      )
      .returning();
    if (!row) throw new AppError("not_found", "Consent not found", "consentNotFound");
    await publishEvents(tx, [
      {
        type: "consent.Revoked",
        firmId: grantor.firmId,
        actorUserId: null,
        payload: {
          entityType: "case",
          entityId: grantor.caseId,
          granteeType: row.granteeType,
          granteeRef: row.granteeRef,
        },
      },
    ]);
  });
}
