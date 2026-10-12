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

export type DocumentsEvent =
  | VersionUploaded
  | VersionReleased
  | VersionQuarantined
  | VersionAccepted
  | VersionRejected
  | DocumentUpdated
  | ClientRequestChanged
  | ExpiryFlagged;
