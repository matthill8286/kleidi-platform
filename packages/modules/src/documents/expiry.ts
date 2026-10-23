export type ExpiryStatus = "no_expiry" | "valid" | "expiring" | "expired";

// A week's notice: longer would flag a fresh 30-day search the day it arrives.
export const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** expiresOn is an ISO date (YYYY-MM-DD), compared in UTC. */
export function expiryStatus(expiresOn: string | null, today: Date): ExpiryStatus {
  if (!expiresOn) return "no_expiry";
  const expiry = Date.parse(`${expiresOn}T00:00:00Z`);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysLeft = Math.round((expiry - start) / DAY_MS);
  if (daysLeft < 0) return "expired";
  if (daysLeft <= EXPIRY_WARNING_DAYS) return "expiring";
  return "valid";
}
