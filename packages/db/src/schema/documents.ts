import {
  bigint,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, updatedAt } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";

// uploading: link issued, file not yet confirmed. pending: waiting for the virus scan.
export const scanStatus = pgEnum("scan_status", [
  "uploading",
  "pending",
  "clean",
  "infected",
  "failed",
]);
export const visibility = pgEnum("visibility", ["client", "firm"]);

// One document per checklist item or ad-hoc title; each upload is a new version.
export const documents = pgTable(
  "documents",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    requirementKey: text("requirement_key"),
    title: text("title").notNull(),
    // Firm-only until a lawyer shares it with the buyer.
    visibility: visibility("visibility").notNull().default("firm"),
    expiresOn: date("expires_on"),
    // The expiry state last announced, so the daily job flags each change once.
    expiryFlag: text("expiry_flag"),
    latestVersion: integer("latest_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("documents_case").on(t.caseId),
    index("documents_expires_on").on(t.expiresOn),
    uniqueIndex("documents_case_requirement").on(t.caseId, t.requirementKey),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    firmId: firmRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    // Where the bytes are now: the quarantine key until a clean scan releases the file.
    objectKey: text("object_key").notNull(),
    scanStatus: scanStatus("scan_status").notNull().default("uploading"),
    scanDetail: text("scan_detail"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("document_versions_doc_version").on(t.documentId, t.version)],
);
