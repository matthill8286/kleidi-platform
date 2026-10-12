import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.ts";
import { cases } from "./cases.ts";
import { createdAt, id } from "./columns.ts";
import { firmRef } from "./firms.ts";

export const channel = pgEnum("channel", ["email", "sms"]);
export const deliveryStatus = pgEnum("delivery_status", ["queued", "sent", "failed"]);

export const notifications = pgTable("notifications", {
  id: id(),
  firmId: firmRef(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
  channel: channel("channel").notNull(),
  template: text("template").notNull(),
  userId: uuid("user_id").references(() => users.id),
  recipient: text("recipient").notNull(),
  locale: text("locale").notNull().default("en"),
  dedupeKey: text("dedupe_key").unique(),
  status: deliveryStatus("status").notNull().default("queued"),
  providerId: text("provider_id"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
});
