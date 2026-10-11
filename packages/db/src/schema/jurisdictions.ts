import { integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, type Localised } from "./columns.ts";

// Jurisdiction configuration: new countries are new rows, not new code.
export const jurisdictions = pgTable("jurisdictions", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  defaultLocale: text("default_locale").notNull(),
});

export const stageTemplates = pgTable(
  "stage_templates",
  {
    id: id(),
    jurisdictionCode: text("jurisdiction_code")
      .notNull()
      .references(() => jurisdictions.code),
    key: text("key").notNull(),
    sortOrder: integer("sort_order").notNull(),
    label: jsonb("label").$type<Localised>().notNull(),
  },
  (t) => [uniqueIndex("stage_templates_jurisdiction_key").on(t.jurisdictionCode, t.key)],
);

export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: id(),
    jurisdictionCode: text("jurisdiction_code")
      .notNull()
      .references(() => jurisdictions.code),
    stageKey: text("stage_key").notNull(),
    key: text("key").notNull(),
    sortOrder: integer("sort_order").notNull(),
    label: jsonb("label").$type<Localised>().notNull(),
    help: jsonb("help").$type<Localised>().notNull(),
    expiryDays: integer("expiry_days"),
  },
  (t) => [uniqueIndex("document_requirements_jurisdiction_key").on(t.jurisdictionCode, t.key)],
);
