import { expiryStatus, type ExpiryStatus } from "./expiry.ts";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// What lawyers actually receive: scans, photos and Word files. Extensions follow the type.
export const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

export type ScanStatus = "uploading" | "pending" | "clean" | "infected" | "failed";

/** Returns why an upload is refused, or null when it may go ahead. */
export function uploadProblem(file: {
  fileName: string;
  mimeType: string;
  byteSize: number;
}): { key: string; text: string } | null {
  if (!ALLOWED_TYPES[file.mimeType])
    return {
      key: "fileType",
      text: "This file type is not accepted. Upload a PDF, image or Word file.",
    };
  if (file.byteSize <= 0) return { key: "fileEmpty", text: "The file is empty" };
  if (file.byteSize > MAX_UPLOAD_BYTES)
    return { key: "fileTooBig", text: "Files can be at most 25 MB" };
  if (!file.fileName.trim() || file.fileName.length > 200)
    return { key: "fileName", text: "The file name is not valid" };
  return null;
}

/** Uploads land here first. Nothing in quarantine can be downloaded. */
export const quarantineKey = (firmId: string, versionId: string) =>
  `quarantine/${firmId}/${versionId}`;

/** Where a file lives once a clean scan releases it. */
export const releasedKey = (firmId: string, caseId: string, versionId: string, mimeType: string) =>
  `firms/${firmId}/cases/${caseId}/${versionId}.${ALLOWED_TYPES[mimeType] ?? "bin"}`;

/** A document that goes stale, such as a search certificate, expires this many days after upload. */
export function defaultExpiry(expiryDays: number | null, today: Date): string | null {
  if (!expiryDays) return null;
  const d = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + expiryDays),
  );
  return d.toISOString().slice(0, 10);
}

export type ReviewStatus = "pending" | "accepted" | "rejected";

export type ItemState =
  | "missing"
  | "scanning"
  | "review"
  | "rejected"
  | "ready"
  | "infected"
  | "failed"
  | "expiring"
  | "expired";

/**
 * What a checklist item shows, from its latest version and expiry date. A clean file waits
 * for a lawyer's review; only an accepted file makes the item ready.
 */
export function itemState(
  latest: { scanStatus: ScanStatus; review: ReviewStatus } | null,
  expiresOn: string | null,
  today: Date,
): ItemState {
  if (!latest || latest.scanStatus === "uploading") return "missing";
  if (latest.scanStatus === "pending") return "scanning";
  if (latest.scanStatus === "infected") return "infected";
  if (latest.scanStatus === "failed") return "failed";
  const expiry: ExpiryStatus = expiryStatus(expiresOn, today);
  if (expiry === "expired") return "expired";
  if (latest.review === "rejected") return "rejected";
  if (latest.review === "pending") return "review";
  return expiry === "expiring" ? "expiring" : "ready";
}

/** Items that need the lawyer's attention come first, so the outstanding work is on top. */
const ORDER: Record<ItemState, number> = {
  infected: 0,
  failed: 0,
  rejected: 0,
  expired: 1,
  review: 2,
  missing: 3,
  expiring: 4,
  scanning: 5,
  ready: 6,
};

export const needsAttention = (state: ItemState) => ORDER[state] <= 4;

/** A checklist item is done once a lawyer has accepted a clean file, even if it expires soon. */
export const isDone = (state: ItemState) => state === "ready" || state === "expiring";

export function sortChecklist<T extends { state: ItemState; sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.sortOrder - b.sortOrder);
}
