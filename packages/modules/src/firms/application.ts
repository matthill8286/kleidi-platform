import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { publishEvents, type Db, type Tx } from "@kleidi/db";
import { firmInvitations, firmMembers, firms } from "@kleidi/db/schema/firms";
import { AppError, systemClock, type Clock } from "@kleidi/kernel";
import { findUsersByIds } from "../identity/index.ts";
import {
  canManageTeam,
  hashToken,
  invitationExpiry,
  invitationState,
  newInvitationToken,
  normaliseEmail,
  slugify,
  type Role,
} from "./domain.ts";
import type { FirmCreated, MemberInvited, MemberJoined } from "./events.ts";

export type Actor = { userId: string; name: string; email: string };
export type FirmContext = { firmId: string; role: Role };

export async function createFirm(db: Db, input: { name: string; actor: Actor }) {
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("invalid", "Firm name is too short", "firmNameShort");
  return db.transaction(async (tx) => {
    const base = slugify(name);
    const taken = await tx
      .select({ id: firms.id })
      .from(firms)
      .where(eq(firms.slug, base))
      .limit(1);
    const slug = taken.length ? `${base}-${crypto.randomUUID().slice(0, 6)}` : base;
    const [firm] = await tx
      .insert(firms)
      .values({ name, slug, jurisdictionCode: "CY" })
      .returning();
    if (!firm) throw new Error("Firm insert returned no row");
    await tx
      .insert(firmMembers)
      .values({ firmId: firm.id, userId: input.actor.userId, role: "firm_admin" });
    const event: FirmCreated = {
      type: "firms.FirmCreated",
      firmId: firm.id,
      actorUserId: input.actor.userId,
      payload: { entityType: "firm", entityId: firm.id, name },
    };
    await publishEvents(tx, [event]);
    return firm;
  });
}

export function listMyFirms(db: Db, userId: string) {
  return db
    .select({ id: firms.id, name: firms.name, slug: firms.slug, role: firmMembers.role })
    .from(firmMembers)
    .innerJoin(firms, eq(firms.id, firmMembers.firmId))
    .where(eq(firmMembers.userId, userId))
    .orderBy(asc(firms.name));
}

/** Every firm id, for jobs that run firm by firm so row-level security still applies. */
export async function listFirmIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: firms.id }).from(firms);
  return rows.map((r) => r.id);
}

/** The country a firm practises in, which decides its case template. */
export async function getFirmJurisdiction(db: Db | Tx, firmId: string): Promise<string> {
  const [row] = await db
    .select({ code: firms.jurisdictionCode })
    .from(firms)
    .where(eq(firms.id, firmId))
    .limit(1);
  if (!row) throw new AppError("not_found", "Firm not found", "firmNotFound");
  return row.code;
}

/** The caller's role in a firm, or null when they are not a member. */
export async function getMembership(
  db: Db | Tx,
  userId: string,
  firmId: string,
): Promise<Role | null> {
  const [row] = await db
    .select({ role: firmMembers.role })
    .from(firmMembers)
    .where(and(eq(firmMembers.userId, userId), eq(firmMembers.firmId, firmId)))
    .limit(1);
  return row?.role ?? null;
}

export async function listTeam(db: Db, firmId: string, clock: Clock = systemClock) {
  const members = await db.select().from(firmMembers).where(eq(firmMembers.firmId, firmId));
  const users = await findUsersByIds(
    db,
    members.map((m) => m.userId),
  );
  const pending = await db
    .select({
      id: firmInvitations.id,
      email: firmInvitations.email,
      role: firmInvitations.role,
      expiresAt: firmInvitations.expiresAt,
    })
    .from(firmInvitations)
    .where(
      and(
        eq(firmInvitations.firmId, firmId),
        isNull(firmInvitations.acceptedAt),
        gt(firmInvitations.expiresAt, clock.now()),
      ),
    );
  return {
    members: members.map((m) => {
      const user = users.find((u) => u.id === m.userId);
      return {
        userId: m.userId,
        role: m.role,
        name: user?.name ?? "",
        email: user?.email ?? "",
        joinedAt: m.createdAt,
      };
    }),
    invitations: pending,
  };
}

export async function inviteMember(
  db: Db,
  input: { firm: FirmContext; actor: Actor; email: string; role: Role },
  clock: Clock = systemClock,
) {
  if (!canManageTeam(input.firm.role))
    throw new AppError("forbidden", "Only firm admins can invite people", "adminsOnlyInvite");
  const email = normaliseEmail(input.email);
  const team = await listTeam(db, input.firm.firmId, clock);
  if (team.members.some((m) => normaliseEmail(m.email) === email)) {
    throw new AppError("conflict", "That person is already a member of this firm", "alreadyMember");
  }
  return db.transaction(async (tx) => {
    const [firm] = await tx.select().from(firms).where(eq(firms.id, input.firm.firmId)).limit(1);
    if (!firm) throw new AppError("not_found", "Firm not found", "firmNotFound");
    const { token, tokenHash } = newInvitationToken();
    const expiresAt = invitationExpiry(clock.now());
    const [invitation] = await tx
      .insert(firmInvitations)
      .values({
        firmId: firm.id,
        email,
        role: input.role,
        tokenHash,
        invitedById: input.actor.userId,
        expiresAt,
      })
      .returning();
    if (!invitation) throw new Error("Invitation insert returned no row");
    const event: MemberInvited = {
      type: "firms.MemberInvited",
      firmId: firm.id,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "invitation",
        entityId: invitation.id,
        email,
        role: input.role,
        token,
        firmName: firm.name,
        inviterName: input.actor.name,
        expiresAt: expiresAt.toISOString(),
      },
    };
    await publishEvents(tx, [event]);
    return { id: invitation.id, email, role: input.role, expiresAt };
  });
}

/** What the invitee sees before accepting. */
export async function previewInvitation(db: Db, token: string, clock: Clock = systemClock) {
  const [row] = await db
    .select({ invitation: firmInvitations, firmName: firms.name })
    .from(firmInvitations)
    .innerJoin(firms, eq(firms.id, firmInvitations.firmId))
    .where(eq(firmInvitations.tokenHash, hashToken(token)))
    .limit(1);
  if (!row)
    throw new AppError("not_found", "This invitation link is not valid", "invitationInvalid");
  return {
    firmName: row.firmName,
    email: row.invitation.email,
    role: row.invitation.role,
    state: invitationState(row.invitation, clock.now()),
  };
}

export async function acceptInvitation(
  db: Db,
  input: { token: string; actor: Actor },
  clock: Clock = systemClock,
) {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(firmInvitations)
      .where(eq(firmInvitations.tokenHash, hashToken(input.token)))
      .limit(1)
      .for("update");
    if (!invitation)
      throw new AppError("not_found", "This invitation link is not valid", "invitationInvalid");
    const state = invitationState(invitation, clock.now());
    if (state === "expired")
      throw new AppError(
        "expired",
        "This invitation has expired. Ask for a new one.",
        "invitationExpired",
      );
    if (state === "accepted")
      throw new AppError("conflict", "This invitation has already been used", "invitationUsed");
    if (normaliseEmail(input.actor.email) !== invitation.email) {
      throw new AppError(
        "forbidden",
        `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`,
        "invitationOtherEmail",
        { email: invitation.email },
      );
    }
    await tx
      .insert(firmMembers)
      .values({ firmId: invitation.firmId, userId: input.actor.userId, role: invitation.role })
      .onConflictDoNothing();
    await tx
      .update(firmInvitations)
      .set({ acceptedAt: clock.now() })
      .where(eq(firmInvitations.id, invitation.id));
    const event: MemberJoined = {
      type: "firms.MemberJoined",
      firmId: invitation.firmId,
      actorUserId: input.actor.userId,
      payload: { entityType: "member", entityId: input.actor.userId, role: invitation.role },
    };
    await publishEvents(tx, [event]);
    return { firmId: invitation.firmId, role: invitation.role };
  });
}
