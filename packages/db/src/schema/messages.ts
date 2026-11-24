import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { caseParties, cases } from "./cases.ts";
import { createdAt, id } from "./columns.ts";
import { firmRef } from "./firms.ts";
import { users } from "./identity.ts";

// One thread per case between the firm and its clients. A message has either a firm author or a
// client author, never both.
export const caseMessages = pgTable(
  "case_messages",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    partyId: uuid("party_id").references(() => caseParties.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("case_messages_case").on(t.caseId, t.createdAt)],
);
