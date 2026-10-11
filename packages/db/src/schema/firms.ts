import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.ts";
import { users } from "./identity.ts";
import { jurisdictions } from "./jurisdictions.ts";

export const memberRole = pgEnum("member_role", ["firm_admin", "lawyer", "staff"]);

export const firms = pgTable("firms", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  jurisdictionCode: text("jurisdiction_code")
    .notNull()
    .references(() => jurisdictions.code),
  retentionYears: integer("retention_years").notNull().default(10),
  createdAt: createdAt(),
});

/** Every firm-owned row carries firm_id so row-level security can filter it. */
export const firmRef = () =>
  uuid("firm_id")
    .notNull()
    .references(() => firms.id, { onDelete: "cascade" });

// Unscoped: login resolves a user's firms before any firm is selected.
export const firmMembers = pgTable(
  "firm_members",
  {
    firmId: firmRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.firmId, t.userId] }),
    index("firm_members_user_idx").on(t.userId),
  ],
);

// Unscoped: an invitee has no firm yet. Only the token hash is stored.
export const firmInvitations = pgTable(
  "firm_invitations",
  {
    id: id(),
    firmId: firmRef(),
    email: text("email").notNull(),
    role: memberRole("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("firm_invitations_firm_idx").on(t.firmId)],
);
