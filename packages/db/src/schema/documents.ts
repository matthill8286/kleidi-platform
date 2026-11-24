import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { caseParties, cases } from "./cases.ts";
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
// A clean file still needs a lawyer to accept it before its checklist item counts as done.
export const reviewStatus = pgEnum("review_status", ["pending", "accepted", "rejected"]);

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
    // The lawyer asked the client for this; it shows in the client's portal.
    requestedFromClient: boolean("requested_from_client").notNull().default(false),
    // The client who started this document through the portal; only they see it there.
    createdByPartyId: uuid("created_by_party_id").references(() => caseParties.id),
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
    review: reviewStatus("review").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // A firm user or, through the portal, a case party uploaded it.
    uploadedById: uuid("uploaded_by_id").references(() => users.id),
    uploadedByPartyId: uuid("uploaded_by_party_id").references(() => caseParties.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("document_versions_doc_version").on(t.documentId, t.version)],
);

// An AI explanation of one document version, from Kleidi Assist, asked for by a client in the
// portal. Only the client who asked sees it.
export const documentExplanations = pgTable(
  "document_explanations",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => caseParties.id),
    kind: text("kind").notNull(),
    question: text("question"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    markdown: text("markdown").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("document_explanations_case").on(t.caseId)],
);

/**
 * Kleidi Assist's review of a lease, for England and Wales leasehold sales. The lawyer edits the
 * report and the buyer's summary while it is a draft; approving it translates the summary and
 * shows it in the buyer's portal.
 */
export const leaseReviews = pgTable(
  "lease_reviews",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    // What the buyer told the lawyer, which changes the flags.
    buyer: jsonb("buyer")
      .$type<{
        plansToLet?: boolean | undefined;
        propertyValue?: number | undefined;
        inLondon?: boolean | undefined;
      }>()
      .notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    report: text("report").notNull(),
    buyerSummary: text("buyer_summary").notNull(),
    // Greek and Russian versions of the approved summary, keyed by locale.
    translations: jsonb("translations").$type<Record<string, string>>(),
    model: text("model").notNull(),
    status: text("status").notNull().default("draft"),
    createdById: uuid("created_by_id").references(() => users.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("lease_reviews_case").on(t.caseId)],
);
