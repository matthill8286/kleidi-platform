import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";
import { jurisdictions } from "./jurisdictions.ts";

export const caseStatus = pgEnum("case_status", ["open", "on_hold", "completed", "cancelled"]);
export const partyRole = pgEnum("party_role", ["buyer", "seller", "developer", "bank"]);

export const cases = pgTable(
  "cases",
  {
    id: id(),
    firmId: firmRef(),
    jurisdictionCode: text("jurisdiction_code")
      .notNull()
      .references(() => jurisdictions.code),
    reference: text("reference").notNull(),
    propertyAddress: text("property_address"),
    plotOrRegNo: text("plot_or_reg_no"),
    propertyType: text("property_type"),
    developerName: text("developer_name"),
    currentStageKey: text("current_stage_key").notNull(),
    status: caseStatus("status").notNull().default("open"),
    // Why the case is on hold or cancelled.
    statusReason: text("status_reason"),
    assignedLawyerId: uuid("assigned_lawyer_id").references(() => users.id),
    // Optimistic concurrency: updates must name the version they read.
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("cases_firm_reference").on(t.firmId, t.reference),
    index("cases_firm_status").on(t.firmId, t.status),
  ],
);

export const caseParties = pgTable(
  "case_parties",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    role: partyRole("role").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    userId: uuid("user_id").references(() => users.id),
    // Removed parties stay on record, so files they sent and the audit trail keep their name.
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedById: uuid("removed_by_id").references(() => users.id),
  },
  (t) => [index("case_parties_case").on(t.caseId)],
);

export const caseStages = pgTable(
  "case_stages",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    stageKey: text("stage_key").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("case_stages_case").on(t.caseId)],
);

// Per-firm, per-year sequence behind references like CY-2026-007.
export const caseCounters = pgTable(
  "case_counters",
  {
    firmId: firmRef(),
    year: integer("year").notNull(),
    last: integer("last").notNull(),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.year] })],
);
