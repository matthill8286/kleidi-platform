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
export function uploadProblem(file: { fileName: string; mimeType: string; byteSize: number }) {
  if (!ALLOWED_TYPES[file.mimeType])
    return "This file type is not accepted. Upload a PDF, image or Word file.";
  if (file.byteSize <= 0) return "The file is empty";
  if (file.byteSize > MAX_UPLOAD_BYTES) return "Files can be at most 25 MB";
  if (!file.fileName.trim() || file.fileName.length > 200) return "The file name is not valid";
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

export type ItemState =
  "missing" | "scanning" | "ready" | "infected" | "failed" | "expiring" | "expired";

/** What a checklist item shows, from its latest version and expiry date. */
export function itemState(
  latest: { scanStatus: ScanStatus } | null,
  expiresOn: string | null,
  today: Date,
): ItemState {
  if (!latest || latest.scanStatus === "uploading") return "missing";
  if (latest.scanStatus === "pending") return "scanning";
  if (latest.scanStatus === "infected") return "infected";
  if (latest.scanStatus === "failed") return "failed";
  const expiry: ExpiryStatus = expiryStatus(expiresOn, today);
  return expiry === "expired" ? "expired" : expiry === "expiring" ? "expiring" : "ready";
}

/** Items that need the lawyer's attention come first, so the outstanding work is on top. */
const ORDER: Record<ItemState, number> = {
  infected: 0,
  failed: 0,
  expired: 1,
  missing: 2,
  expiring: 3,
  scanning: 4,
  ready: 5,
};

export const needsAttention = (state: ItemState) => ORDER[state] <= 3;

export function sortChecklist<T extends { state: ItemState; sortOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.sortOrder - b.sortOrder);
}
