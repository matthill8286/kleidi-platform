import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { caseParties, cases } from "./cases.ts";
import { id } from "./columns.ts";
import { firmRef } from "./firms.ts";

export const granteeType = pgEnum("grantee_type", ["agent", "bank", "insurer"]);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    grantorPartyId: uuid("grantor_party_id")
      .notNull()
      .references(() => caseParties.id, { onDelete: "cascade" }),
    granteeType: granteeType("grantee_type").notNull(),
    granteeRef: text("grantee_ref").notNull(),
    scope: text("scope").notNull().default("status"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("consents_case").on(t.caseId)],
);
