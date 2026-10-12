import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, updatedAt } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";

export const deadlines = pgTable(
  "deadlines",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    remindBeforeHours: jsonb("remind_before_hours").$type<number[]>().notNull().default([72, 24]),
    // Offsets already announced, so a second worker run sends nothing twice.
    remindersSent: jsonb("reminders_sent").$type<number[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedById: uuid("completed_by_id").references(() => users.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("deadlines_due_at").on(t.dueAt), index("deadlines_case").on(t.caseId)],
);
