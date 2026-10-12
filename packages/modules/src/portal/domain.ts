import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const INVITE_LINK_DAYS = 7;
export const SIGN_IN_LINK_MINUTES = 30;
export const CODE_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_LINK = 5;
export const RESEND_SECONDS = 30;
export const SESSION_DAYS = 7;
// Bump when the privacy notice changes; clients accept the new version on their next visit.
export const PRIVACY_VERSION = "2026-10";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** A random token for a link or session; only its hash is stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Compares a typed code with the stored hash without leaking timing. */
export function codeMatches(code: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(code.replace(/\s/g, "")));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "+35799123456" -> "+357 ••••• 456": enough for the client to recognise their phone. */
export function maskPhone(phone: string): string {
  const country = phone.slice(0, 4);
  return `${country} ${"•".repeat(Math.max(phone.length - 7, 2))} ${phone.slice(-3)}`;
}

export const linkExpiry = (now: Date, kind: "invite" | "sign-in") =>
  new Date(
    now.getTime() + (kind === "invite" ? INVITE_LINK_DAYS * DAY : SIGN_IN_LINK_MINUTES * MINUTE),
  );
export const codeExpiry = (now: Date) => new Date(now.getTime() + CODE_MINUTES * MINUTE);
export const sessionExpiry = (now: Date) => new Date(now.getTime() + SESSION_DAYS * DAY);

type LinkState = {
  expiresAt: Date;
  usedAt: Date | null;
  codeHash: string | null;
  codeExpiresAt: Date | null;
  codeAttempts: number;
  codesSent: number;
};

/** Why a link cannot be used now, as a message key, or null when it can. */
export function linkProblem(link: LinkState, now: Date): string | null {
  if (link.usedAt) return "linkUsed";
  if (link.expiresAt <= now) return "linkExpired";
  return null;
}

/** Whether to text a new code: none yet, the last one expired, or the client asked again. */
export function shouldSendCode(
  link: LinkState,
  now: Date,
  resend: boolean,
): "send" | "wait" | "keep" | "limit" {
  const sentAt = link.codeExpiresAt
    ? new Date(link.codeExpiresAt.getTime() - CODE_MINUTES * MINUTE)
    : null;
  const live = link.codeHash && link.codeExpiresAt && link.codeExpiresAt > now;
  if (live && !resend) return "keep";
  if (sentAt && now.getTime() - sentAt.getTime() < RESEND_SECONDS * 1000) return "wait";
  if (link.codesSent >= MAX_CODES_PER_LINK) return "limit";
  return "send";
}

/** Why a typed code cannot be checked, or null when it can. */
export function codeProblem(link: LinkState, now: Date): string | null {
  if (!link.codeHash || !link.codeExpiresAt) return "codeNotSent";
  if (link.codeAttempts >= MAX_CODE_ATTEMPTS) return "tooManyAttempts";
  if (link.codeExpiresAt <= now) return "codeExpired";
  return null;
}
