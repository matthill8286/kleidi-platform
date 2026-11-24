import { and, asc, count, eq, sql } from "drizzle-orm";
import { publishEvents, withFirm, type Db, type Tx } from "@kleidi/db";
import { paymentTranches } from "@kleidi/db/schema/payments";
import { AppError, type DomainEvent } from "@kleidi/kernel";
import { findCase } from "../cases/index.ts";
import type { Actor, FirmContext } from "../firms/index.ts";
import { findJurisdiction } from "../jurisdictions/index.ts";

export const PAYMENT_STATUSES = ["due", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

type OnPayment = { entityType: "case"; entityId: string; paymentId: string; label: string };
export type PaymentAdded = DomainEvent<
  "payments.PaymentAdded",
  OnPayment & { amountMinor: number; currency: string }
>;
export type PaymentChanged = DomainEvent<
  "payments.PaymentChanged",
  OnPayment & { status?: PaymentStatus }
>;
export type PaymentRemoved = DomainEvent<"payments.PaymentRemoved", OnPayment>;

const MAX_AMOUNT = 1_000_000_000_00;

function checkLabel(label: string) {
  const text = label.trim();
  if (text.length < 2 || text.length > 120) {
    throw new AppError("invalid", "Give the payment a short name", "paymentLabel");
  }
  return text;
}

function checkAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new AppError("invalid", "Enter an amount above zero", "paymentAmount");
  }
  return amount;
}

async function caseOrThrow(tx: Tx, caseId: string) {
  const c = await findCase(tx, caseId);
  if (!c) throw new AppError("not_found", "Case not found", "caseNotFound");
  return c;
}

const view = (p: typeof paymentTranches.$inferSelect) => ({
  id: p.id,
  label: p.label,
  amountMinor: p.amountMinor,
  currency: p.currency,
  dueOn: p.dueOn,
  payTo: p.payTo,
  status: p.status,
  paidOn: p.paidOn,
});

/** The schedule, soonest due first, undated instalments last. */
export async function listPayments(db: Db, firmId: string, caseId: string) {
  return withFirm(db, firmId, async (tx) => {
    await caseOrThrow(tx, caseId);
    const rows = await tx
      .select()
      .from(paymentTranches)
      .where(eq(paymentTranches.caseId, caseId))
      .orderBy(sql`${paymentTranches.dueOn} asc nulls last`, asc(paymentTranches.sortOrder));
    return rows.map(view);
  });
}

export async function addPayment(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    label: string;
    amountMinor: number;
    dueOn?: string | null | undefined;
    payTo?: string | null | undefined;
  },
) {
  const label = checkLabel(input.label);
  const amountMinor = checkAmount(input.amountMinor);
  return withFirm(db, input.firm.firmId, async (tx) => {
    const c = await caseOrThrow(tx, input.caseId);
    const currency = (await findJurisdiction(tx, c.jurisdictionCode))?.currency ?? "EUR";
    const [existing] = await tx
      .select({ n: count() })
      .from(paymentTranches)
      .where(eq(paymentTranches.caseId, c.id));
    const [row] = await tx
      .insert(paymentTranches)
      .values({
        firmId: input.firm.firmId,
        caseId: c.id,
        label,
        amountMinor,
        currency,
        dueOn: input.dueOn ?? null,
        payTo: input.payTo?.trim() || null,
        sortOrder: ((existing?.n ?? 0) + 1) * 10,
      })
      .returning();
    const event: PaymentAdded = {
      type: "payments.PaymentAdded",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: c.id,
        paymentId: row!.id,
        label,
        amountMinor,
        currency,
      },
    };
    await publishEvents(tx, [event]);
    return view(row!);
  });
}

async function paymentOrThrow(tx: Tx, paymentId: string) {
  const [row] = await tx
    .select()
    .from(paymentTranches)
    .where(eq(paymentTranches.id, paymentId))
    .for("update");
  if (!row) throw new AppError("not_found", "Payment not found", "paymentNotFound");
  return row;
}

export async function updatePayment(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    paymentId: string;
    label?: string | undefined;
    amountMinor?: number | undefined;
    dueOn?: string | null | undefined;
    payTo?: string | null | undefined;
    status?: PaymentStatus | undefined;
    paidOn?: string | null | undefined;
  },
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const current = await paymentOrThrow(tx, input.paymentId);
    const status = input.status ?? current.status;
    const [row] = await tx
      .update(paymentTranches)
      .set({
        ...(input.label !== undefined ? { label: checkLabel(input.label) } : {}),
        ...(input.amountMinor !== undefined ? { amountMinor: checkAmount(input.amountMinor) } : {}),
        ...(input.dueOn !== undefined ? { dueOn: input.dueOn } : {}),
        ...(input.payTo !== undefined ? { payTo: input.payTo?.trim() || null } : {}),
        status,
        // Marking a payment due again clears its paid date.
        paidOn: status === "paid" ? (input.paidOn ?? current.paidOn) : null,
      })
      .where(and(eq(paymentTranches.id, current.id)))
      .returning();
    const event: PaymentChanged = {
      type: "payments.PaymentChanged",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: current.caseId,
        paymentId: current.id,
        label: row!.label,
        ...(input.status ? { status: input.status } : {}),
      },
    };
    await publishEvents(tx, [event]);
    return view(row!);
  });
}

export async function removePayment(
  db: Db,
  input: { firm: FirmContext; actor: Actor; paymentId: string },
) {
  await withFirm(db, input.firm.firmId, async (tx) => {
    const current = await paymentOrThrow(tx, input.paymentId);
    await tx.delete(paymentTranches).where(eq(paymentTranches.id, current.id));
    const event: PaymentRemoved = {
      type: "payments.PaymentRemoved",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        entityType: "case",
        entityId: current.caseId,
        paymentId: current.id,
        label: current.label,
      },
    };
    await publishEvents(tx, [event]);
  });
}
