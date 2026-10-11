import { bigint, date, index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";

export const scanStatus = pgEnum("scan_status", ["pending", "clean", "infected"]);
export const visibility = pgEnum("visibility", ["client", "firm"]);

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
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    version: integer("version").notNull().default(1),
    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id),
    expiresOn: date("expires_on"),
    scanStatus: scanStatus("scan_status").notNull().default("pending"),
    visibility: visibility("visibility").notNull().default("client"),
    createdAt: createdAt(),
  },
  (t) => [index("documents_case").on(t.caseId), index("documents_expires_on").on(t.expiresOn)],
);
