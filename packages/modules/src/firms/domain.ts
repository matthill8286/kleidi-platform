import { createHash, randomBytes } from "node:crypto";

export const ROLES = ["firm_admin", "lawyer", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Only firm admins manage the team. */
export const canManageTeam = (role: Role): boolean => role === "firm_admin";

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** "Christou & Co" -> "christou-co". Greek and other non-Latin letters are dropped. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "firm";
}

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** A random invitation token; only its hash is stored. */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export const invitationExpiry = (now: Date): Date =>
  new Date(now.getTime() + INVITATION_DAYS * DAY_MS);

export type InvitationState = "pending" | "accepted" | "expired";

export function invitationState(
  invitation: { expiresAt: Date; acceptedAt: Date | null },
  now: Date,
): InvitationState {
  if (invitation.acceptedAt) return "accepted";
  return invitation.expiresAt.getTime() <= now.getTime() ? "expired" : "pending";
}
