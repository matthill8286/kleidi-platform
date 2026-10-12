import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { caseParties, cases } from "./cases.ts";
import { createdAt, id } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";

// A client's way into one case. Firm-scoped: everything it unlocks belongs to the firm.
export const portalAccess = pgTable(
  "portal_access",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    partyId: uuid("party_id")
      .notNull()
      .references(() => caseParties.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    locale: text("locale").notNull().default("en"),
    invitedById: uuid("invited_by_id")
      .notNull()
      .references(() => users.id),
    // The privacy notice the client accepted, and when: their consent record.
    privacyVersion: text("privacy_version"),
    privacyAcceptedAt: timestamp("privacy_accepted_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("portal_access_party").on(t.partyId),
    index("portal_access_email").on(t.email),
  ],
);

// Sign-in links and their SMS codes. Unscoped: a link is looked up before the firm is known.
export const portalLinks = pgTable("portal_links", {
  id: id(),
  firmId: uuid("firm_id").notNull(),
  accessId: uuid("access_id")
    .notNull()
    .references(() => portalAccess.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  codeAttempts: integer("code_attempts").notNull().default(0),
  codesSent: integer("codes_sent").notNull().default(0),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// Signed-in client sessions. Unscoped for the same reason; the cookie holds the token.
export const portalSessions = pgTable("portal_sessions", {
  id: id(),
  firmId: uuid("firm_id").notNull(),
  accessId: uuid("access_id")
    .notNull()
    .references(() => portalAccess.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});
