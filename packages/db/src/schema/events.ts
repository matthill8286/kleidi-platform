import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id } from "./columns.ts";

// Transactional outbox: written in the same transaction as the change it describes.
// Unscoped by design: the worker relays every firm's events.
export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    // Commit order within a transaction, where occurred_at ties.
    position: bigserial("position", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    firmId: uuid("firm_id"),
    actorUserId: uuid("actor_user_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [
    index("outbox_unpublished")
      .on(t.position)
      .where(sql`published_at is null`),
  ],
);

// Idempotent consumers: one row per consumer per event it has handled.
export const processedEvents = pgTable(
  "processed_events",
  {
    consumer: text("consumer").notNull(),
    eventId: uuid("event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.eventId] })],
);
