/**
 * A firm's licence, as the Impakt account service reports it. Kleidi keeps its own users and
 * sign-in; the licence says only whether a firm may use Kleidi and how much.
 */
export type LicenceStatus = "pending" | "active" | "grace" | "read_only" | "expired" | "suspended";

export type Licence = {
  id: string;
  plan: string;
  status: LicenceStatus;
  /** How many lawyers and staff the firm may have, or null for no limit. */
  seats: number | null;
  /** Ceilings Kleidi enforces, such as `casesOpened`. */
  limits: Record<string, number>;
  endsAt: string | null;
  graceEndsAt: string | null;
  readOnlyEndsAt: string | null;
  /** The firm the licence covers, or null until the firm is set up. */
  tenant: string | null;
  /** The addresses allowed to set the firm up. */
  owners: string[];
};

/** `full`: everything works. `read`: nothing can be changed. `none`: the firm cannot be used. */
export type Access = "full" | "read" | "none";

/** What a firm may do under its licence. A firm with no licence may do nothing. */
export function accessFor(licence: Licence | null): Access {
  if (!licence) return "none";
  if (licence.status === "active" || licence.status === "grace") return "full";
  return licence.status === "read_only" ? "read" : "none";
}

/** Whether a request with this HTTP method only reads. */
export const isReadMethod = (method: string): boolean =>
  ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

export type SetUpRefusal =
  "licenceNotFound" | "licenceUsed" | "licenceNotActive" | "licenceNotYours";

/** Why this person may not set a firm up under the licence, or null when they may. */
export function setUpRefusal(licence: Licence | null, email: string): SetUpRefusal | null {
  if (!licence) return "licenceNotFound";
  if (licence.tenant) return "licenceUsed";
  if (accessFor(licence) !== "full") return "licenceNotActive";
  const mine = email.trim().toLowerCase();
  return licence.owners.some((o) => o.trim().toLowerCase() === mine) ? null : "licenceNotYours";
}

/**
 * Whether the firm has room for one more person. Pending invitations hold a seat, so a firm
 * cannot invite more people than it can seat.
 */
export function hasFreeSeat(seats: number | null, members: number, pendingInvitations = 0) {
  return seats === null || members + pendingInvitations < seats;
}

/** The most sales the firm may open under its licence, or null for no limit. */
export const caseLimit = (licence: Licence | null): number | null =>
  licence?.limits.casesOpened ?? null;
