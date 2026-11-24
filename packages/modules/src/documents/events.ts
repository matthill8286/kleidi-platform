import type { DomainEvent } from "@kleidi/kernel";

// Document events are filed under their case, so they appear in the case's activity.
// requirementKey lets readers show a checklist item's title in their own language.
type OnCase = {
  entityType: "case";
  entityId: string;
  documentId: string;
  requirementKey: string | null;
  title: string;
};
type OnVersion = OnCase & {
  versionId: string;
  version: number;
  fileName: string;
  // Set when a client sent the file through the portal.
  client?: string;
};

export type VersionUploaded = DomainEvent<"documents.VersionUploaded", OnVersion>;
export type VersionReleased = DomainEvent<"documents.VersionReleased", OnVersion>;
export type VersionQuarantined = DomainEvent<
  "documents.VersionQuarantined",
  OnVersion & { signature: string }
>;
export type VersionDownloaded = DomainEvent<"documents.VersionDownloaded", OnVersion>;
export type VersionAccepted = DomainEvent<"documents.VersionAccepted", OnVersion>;
export type VersionRejected = DomainEvent<
  "documents.VersionRejected",
  OnVersion & { note: string }
>;
export type ClientRequestChanged = DomainEvent<
  "documents.ClientRequestChanged",
  OnCase & { requested: boolean }
>;
export type DocumentUpdated = DomainEvent<
  "documents.DocumentUpdated",
  OnCase & { visibility?: "client" | "firm"; expiresOn?: string | null }
>;
export type ExpiryFlagged = DomainEvent<
  "documents.ExpiryFlagged",
  OnCase & { state: "expiring" | "expired"; expiresOn: string }
>;

// A client asked Kleidi Assist to explain a document in the portal.
export type ExplanationRequested = DomainEvent<
  "documents.ExplanationRequested",
  OnCase & { explanationId: string; versionId: string; model: string; client: string }
>;

// The firm asked Kleidi Assist to review a lease, and later approved the buyer's summary.
export type LeaseReviewed = DomainEvent<
  "documents.LeaseReviewed",
  OnCase & { reviewId: string; versionId: string; model: string; flags: number }
>;
export type LeaseReviewApproved = DomainEvent<
  "documents.LeaseReviewApproved",
  OnCase & { reviewId: string }
>;

export type DocumentsEvent =
  | VersionUploaded
  | VersionReleased
  | VersionQuarantined
  | VersionAccepted
  | VersionDownloaded
  | VersionRejected
  | DocumentUpdated
  | ClientRequestChanged
  | ExpiryFlagged
  | ExplanationRequested
  | LeaseReviewed
  | LeaseReviewApproved;
