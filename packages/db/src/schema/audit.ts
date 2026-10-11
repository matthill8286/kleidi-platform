import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { firms } from "./firms.ts";
import { users } from "./identity.ts";

// Append-only: a trigger from policies.ts rejects UPDATE and DELETE.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    firmId: uuid("firm_id").references(() => firms.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    eventId: uuid("event_id").unique(),
    eventPosition: bigint("event_position", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_firm_created").on(t.firmId, t.createdAt)],
);
