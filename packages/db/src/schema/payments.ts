import { bigint, date, index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { createdAt, id, updatedAt } from "./columns.ts";
import { firmRef } from "./firms.ts";

export const paymentStatus = pgEnum("payment_status", ["due", "paid"]);

// The buyer's payment schedule: each instalment, when it is due and where it goes.
export const paymentTranches = pgTable(
  "payment_tranches",
  {
    id: id(),
    firmId: firmRef(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // Minor units (cents or pence), so sums are exact.
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    dueOn: date("due_on"),
    // Where the money goes, in words: "Developer's account, details in the contract".
    payTo: text("pay_to"),
    status: paymentStatus("status").notNull().default("due"),
    paidOn: date("paid_on"),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payment_tranches_case").on(t.caseId)],
);
