import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { users } from "./identity.ts";

// API infrastructure: the first response to each Idempotency-Key is replayed for 24 hours.
// Unscoped: keys belong to a user, not a firm.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code"),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("idempotency_keys_user_key").on(t.userId, t.key)],
);
