import { and, eq, isNull, sql } from "drizzle-orm";
import { publishEvents, withFirm, type Db } from "@kleidi/db";
import { portalAccess, portalLinks, portalSessions } from "@kleidi/db/schema/portal";
import { AppError, systemClock, type Clock } from "@kleidi/kernel";
import { findCase, findPartiesByIds, getCase } from "../cases/index.ts";
import { listConsents } from "../consent/index.ts";
import { listClientDocuments } from "../documents/index.ts";
import { getFirmName, listFirmIds, type Actor, type FirmContext } from "../firms/index.ts";
import { findUsersByIds, normalisePhone } from "../identity/index.ts";
import { asLocale, deliver, type Locale, type Notifier } from "../notifications/index.ts";
import {
  codeExpiry,
  codeMatches,
  codeProblem,
  hashSecret,
  linkExpiry,
  linkProblem,
  maskPhone,
  newCode,
  newToken,
  PRIVACY_VERSION,
  sessionExpiry,
  shouldSendCode,
} from "./domain.ts";

/** Who is signed in to the portal: one party on one case at one firm. */
export type PortalSession = {
  sessionId: string;
  firmId: string;
  accessId: string;
  caseId: string;
  partyId: string;
  partyName: string;
  locale: Locale;
  privacyAccepted: boolean;
};

const base = (firmId: string, actorUserId: string | null) => ({ firmId, actorUserId });
const onCase = (caseId: string) => ({ entityType: "case" as const, entityId: caseId });

/** Creates a sign-in link for an access and returns its token, which only the email carries. */
async function createLink(
  db: Db,
  firmId: string,
  accessId: string,
  kind: "invite" | "sign-in",
  clock: Clock,
) {
  const { token, hash } = newToken();
  const [row] = await db
    .insert(portalLinks)
    .values({ firmId, accessId, tokenHash: hash, expiresAt: linkExpiry(clock.now(), kind) })
    .returning({ id: portalLinks.id });
  return { token, linkId: row!.id };
}

/**
 * Gives a case party access to their case. They get an email link; the first visit texts a
 * code to their phone, so the link alone is not enough to get in.
 */
export async function inviteClient(
  db: Db,
  notifier: Notifier,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    partyId: string;
    locale: Locale;
    appUrl: string;
  },
  clock: Clock = systemClock,
) {
  const { access, reference } = await withFirm(db, input.firm.firmId, async (tx) => {
    const c = await findCase(tx, input.caseId);
    if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
    if (c.status === "completed" || c.status === "cancelled") {
      throw new AppError("invalid", `A ${c.status} case cannot change`, "caseClosed", {
        status: c.status,
      });
    }
    const [party] = await findPartiesByIds(tx, [input.partyId]);
    if (!party || party.caseId !== c.id)
      throw new AppError("not_found", "Party not found", "partyNotFound");
    const phone = party.phone ? normalisePhone(party.phone) : null;
    if (!party.email || !phone) {
      throw new AppError(
        "invalid",
        "Add the client's email and mobile number first",
        "clientContactNeeded",
      );
    }
    const [access] = await tx
      .insert(portalAccess)
      .values({
        firmId: input.firm.firmId,
        caseId: c.id,
        partyId: party.id,
        email: party.email.toLowerCase(),
        phone,
        locale: input.locale,
        invitedById: input.actor.userId,
      })
      .onConflictDoUpdate({
        target: portalAccess.partyId,
        set: {
          email: party.email.toLowerCase(),
          phone,
          locale: input.locale,
          invitedById: input.actor.userId,
          revokedAt: null,
        },
      })
      .returning();
    await publishEvents(tx, [
      {
        type: "portal.ClientInvited",
        ...base(input.firm.firmId, input.actor.userId),
        payload: { ...onCase(c.id), partyName: party.fullName },
      },
    ]);
    return { access: access!, reference: c.reference };
  });

  const { token, linkId } = await createLink(db, input.firm.firmId, access.id, "invite", clock);
  await deliver(db, notifier, {
    firmId: input.firm.firmId,
    caseId: input.caseId,
    dedupeKey: `portal-invite:${linkId}`,
    channel: "email",
    to: access.email,
    template: "portal-invitation",
    locale: input.locale,
    data: {
      firmName: await getFirmName(db, input.firm.firmId),
      lawyerName: input.actor.name,
      caseReference: reference,
      link: `${input.appUrl}/portal/link/${token}`,
    },
  });
  return { accessId: access.id };
}

/** Who on a case has portal access, for the firm's parties list. */
export async function listPortalAccess(db: Db, firmId: string, caseId: string) {
  return withFirm(db, firmId, (tx) =>
    tx
      .select({
        id: portalAccess.id,
        partyId: portalAccess.partyId,
        createdAt: portalAccess.createdAt,
        lastSeenAt: portalAccess.lastSeenAt,
        revokedAt: portalAccess.revokedAt,
      })
      .from(portalAccess)
      .where(eq(portalAccess.caseId, caseId)),
  );
}

/** Ends a client's access at once: their sessions stop working too. */
export async function revokeAccess(
  db: Db,
  input: { firm: FirmContext; actor: Actor; accessId: string },
  clock: Clock = systemClock,
) {
  await withFirm(db, input.firm.firmId, async (tx) => {
    const [row] = await tx
      .update(portalAccess)
      .set({ revokedAt: clock.now() })
      .where(and(eq(portalAccess.id, input.accessId), isNull(portalAccess.revokedAt)))
      .returning();
    if (!row) throw new AppError("not_found", "Access not found", "accessNotFound");
    await publishEvents(tx, [
      {
        type: "portal.AccessRevoked",
        ...base(input.firm.firmId, input.actor.userId),
        payload: onCase(row.caseId),
      },
    ]);
  });
  await db
    .update(portalSessions)
    .set({ revokedAt: clock.now() })
    .where(and(eq(portalSessions.accessId, input.accessId), isNull(portalSessions.revokedAt)));
}

/**
 * Emails a fresh sign-in link to every active access with this address. The answer is the
 * same whether or not the address is known, so it cannot be used to find clients.
 */
export async function requestSignInLink(
  db: Db,
  notifier: Notifier,
  input: { email: string; appUrl: string },
  clock: Clock = systemClock,
) {
  const email = input.email.trim().toLowerCase();
  for (const firmId of await listFirmIds(db)) {
    const accesses = await withFirm(db, firmId, (tx) =>
      tx
        .select()
        .from(portalAccess)
        .where(and(eq(portalAccess.email, email), isNull(portalAccess.revokedAt))),
    );
    for (const access of accesses) {
      const { token, linkId } = await createLink(db, firmId, access.id, "sign-in", clock);
      await deliver(db, notifier, {
        firmId,
        caseId: access.caseId,
        dedupeKey: `portal-sign-in:${linkId}`,
        channel: "email",
        to: access.email,
        template: "portal-sign-in",
        locale: asLocale(access.locale),
        data: {
          firmName: await getFirmName(db, firmId),
          link: `${input.appUrl}/portal/link/${token}`,
        },
      });
    }
  }
}

async function loadLink(db: Db, token: string) {
  const [link] = await db
    .select()
    .from(portalLinks)
    .where(eq(portalLinks.tokenHash, hashSecret(token)));
  if (!link) throw new AppError("not_found", "This link is not valid", "linkInvalid");
  return link;
}

async function activeAccess(db: Db, firmId: string, accessId: string) {
  const [access] = await withFirm(db, firmId, (tx) =>
    tx
      .select()
      .from(portalAccess)
      .where(and(eq(portalAccess.id, accessId), isNull(portalAccess.revokedAt))),
  );
  if (!access) throw new AppError("not_found", "This link is not valid", "linkInvalid");
  return access;
}

/** Opens a link: texts a code to the client's phone unless a live one was just sent. */
export async function startLink(
  db: Db,
  notifier: Notifier,
  input: { token: string; resend?: boolean | undefined },
  clock: Clock = systemClock,
) {
  const now = clock.now();
  const link = await loadLink(db, input.token);
  const problem = linkProblem(link, now);
  if (problem) throw new AppError("expired", "This link can no longer be used", problem);
  const access = await activeAccess(db, link.firmId, link.accessId);

  const decision = shouldSendCode(link, now, Boolean(input.resend));
  if (decision === "limit") {
    throw new AppError("invalid", "Too many codes were sent. Ask for a new link.", "tooManyCodes");
  }
  if (decision === "send") {
    const code = newCode();
    const [updated] = await db
      .update(portalLinks)
      .set({
        codeHash: hashSecret(code),
        codeExpiresAt: codeExpiry(now),
        codeAttempts: 0,
        codesSent: sql`${portalLinks.codesSent} + 1`,
      })
      .where(eq(portalLinks.id, link.id))
      .returning({ codesSent: portalLinks.codesSent });
    await deliver(db, notifier, {
      firmId: link.firmId,
      caseId: access.caseId,
      dedupeKey: `portal-code:${link.id}:${updated!.codesSent}`,
      channel: "sms",
      to: access.phone,
      template: "portal-code",
      locale: asLocale(access.locale),
      data: { code },
    });
  }
  const [party] = await withFirm(db, link.firmId, (tx) => findPartiesByIds(tx, [access.partyId]));
  return {
    firmName: await getFirmName(db, link.firmId),
    partyName: party?.fullName ?? "",
    maskedPhone: maskPhone(access.phone),
    locale: asLocale(access.locale),
    sent: decision === "send",
  };
}

/** Checks the texted code. On success the link is spent and a session begins. */
export async function verifyLink(
  db: Db,
  input: { token: string; code: string },
  clock: Clock = systemClock,
) {
  const now = clock.now();
  const result = await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(portalLinks)
      .where(eq(portalLinks.tokenHash, hashSecret(input.token)))
      .for("update");
    if (!link) throw new AppError("not_found", "This link is not valid", "linkInvalid");
    const problem = linkProblem(link, now) ?? codeProblem(link, now);
    if (problem) throw new AppError("expired", "This code can no longer be used", problem);
    // Count the attempt before checking, so guesses are limited even when they fail.
    await tx
      .update(portalLinks)
      .set({ codeAttempts: link.codeAttempts + 1 })
      .where(eq(portalLinks.id, link.id));
    if (!codeMatches(input.code, link.codeHash!)) return { ok: false as const };
    await tx.update(portalLinks).set({ usedAt: now }).where(eq(portalLinks.id, link.id));
    const { token, hash } = newToken();
    const expiresAt = sessionExpiry(now);
    await tx.insert(portalSessions).values({
      firmId: link.firmId,
      accessId: link.accessId,
      tokenHash: hash,
      expiresAt,
    });
    return { ok: true as const, token, expiresAt, link };
  });
  if (!result.ok) throw new AppError("invalid", "That code is not right", "codeWrong");

  const access = await activeAccess(db, result.link.firmId, result.link.accessId);
  await withFirm(db, access.firmId, async (tx) => {
    await tx.update(portalAccess).set({ lastSeenAt: now }).where(eq(portalAccess.id, access.id));
    await publishEvents(tx, [
      {
        type: "portal.ClientSignedIn",
        ...base(access.firmId, null),
        payload: onCase(access.caseId),
      },
    ]);
  });
  return { sessionToken: result.token, expiresAt: result.expiresAt };
}

/** The session behind a cookie, or null when it is missing, expired or revoked. */
export async function sessionFromToken(
  db: Db,
  token: string,
  clock: Clock = systemClock,
): Promise<PortalSession | null> {
  const [session] = await db
    .select()
    .from(portalSessions)
    .where(and(eq(portalSessions.tokenHash, hashSecret(token)), isNull(portalSessions.revokedAt)));
  if (!session || session.expiresAt <= clock.now()) return null;
  const [access] = await withFirm(db, session.firmId, (tx) =>
    tx
      .select()
      .from(portalAccess)
      .where(and(eq(portalAccess.id, session.accessId), isNull(portalAccess.revokedAt))),
  );
  if (!access) return null;
  const [party] = await withFirm(db, session.firmId, (tx) =>
    findPartiesByIds(tx, [access.partyId]),
  );
  return {
    sessionId: session.id,
    firmId: access.firmId,
    accessId: access.id,
    caseId: access.caseId,
    partyId: access.partyId,
    partyName: party?.fullName ?? "",
    locale: asLocale(access.locale),
    privacyAccepted: access.privacyVersion === PRIVACY_VERSION,
  };
}

export async function signOutClient(db: Db, sessionId: string, clock: Clock = systemClock) {
  await db
    .update(portalSessions)
    .set({ revokedAt: clock.now() })
    .where(eq(portalSessions.id, sessionId));
}

/** Records that the client accepted this version of the privacy notice. */
export async function acceptPrivacy(db: Db, session: PortalSession, clock: Clock = systemClock) {
  await withFirm(db, session.firmId, async (tx) => {
    await tx
      .update(portalAccess)
      .set({ privacyVersion: PRIVACY_VERSION, privacyAcceptedAt: clock.now() })
      .where(eq(portalAccess.id, session.accessId));
    await publishEvents(tx, [
      {
        type: "portal.PrivacyAccepted",
        ...base(session.firmId, null),
        payload: { ...onCase(session.caseId), version: PRIVACY_VERSION },
      },
    ]);
  });
}

export async function setClientLocale(db: Db, session: PortalSession, locale: Locale) {
  await withFirm(db, session.firmId, (tx) =>
    tx.update(portalAccess).set({ locale }).where(eq(portalAccess.id, session.accessId)),
  );
}

/**
 * Everything the client sees: where the case stands, who their lawyer is, the documents
 * shared with them or asked of them, and their sharing choices. Nothing firm-internal.
 */
export async function getClientCase(db: Db, session: PortalSession) {
  const c = await getCase(db, session.firmId, session.caseId);
  const [lawyer] = c.assignedLawyer ? await findUsersByIds(db, [c.assignedLawyer.id]) : [];
  const index = c.stages.findIndex((s) => s.key === c.currentStageKey);
  const party = c.parties.find((p) => p.id === session.partyId);
  return {
    firmName: await getFirmName(db, session.firmId),
    lawyer: lawyer ? { name: lawyer.name, email: lawyer.email } : null,
    you: { name: party?.fullName ?? session.partyName, role: party?.role ?? "buyer" },
    case: {
      reference: c.reference,
      propertyAddress: c.propertyAddress,
      status: c.status,
      stages: c.stages.map((s, i) => ({
        key: s.key,
        label: s.label,
        position:
          c.status === "completed" || i < index
            ? ("done" as const)
            : i === index
              ? ("current" as const)
              : ("next" as const),
        reachedAt: c.history.filter((h) => h.stageKey === s.key).at(-1)?.enteredAt ?? null,
      })),
    },
    documents: await listClientDocuments(db, session.firmId, session.caseId, session.partyId),
    consents: await listConsents(db, {
      firmId: session.firmId,
      caseId: session.caseId,
      partyId: session.partyId,
    }),
  };
}
