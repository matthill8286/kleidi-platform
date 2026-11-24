import { and, eq, isNull } from "drizzle-orm";
import { handleOnce, withFirm, type Db } from "@kleidi/db";
import { portalAccess } from "@kleidi/db/schema/portal";
import { systemClock, type Clock, type StoredEvent } from "@kleidi/kernel";
import { findCase } from "../cases/index.ts";
import { getFirmName, listFirmJurisdictions } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import { listJurisdictions } from "../jurisdictions/index.ts";
import type { MessagePosted } from "../messages/index.ts";
import {
  asLocale,
  deliver,
  formatMoney,
  formatWhen,
  localDay,
  localHour,
  type Locale,
  type Notifier,
} from "../notifications/index.ts";
import { findPayment, listPaymentsDueOn, type PaymentAdded } from "../payments/index.ts";

// Alerts about the case's thread and payment schedule. A consumer of its own, so each event is
// handled once here whatever the other consumers do. Message bodies never go into an alert.
export const PORTAL_ALERTS_CONSUMER = "portal-alerts";

type Client = { id: string; email: string; phone: string; locale: Locale };

/** Clients with live portal access to a case: the people client alerts go to. */
async function clientsOf(db: Db, firmId: string, caseId: string): Promise<Client[]> {
  const rows = await withFirm(db, firmId, (tx) =>
    tx
      .select({
        id: portalAccess.id,
        email: portalAccess.email,
        phone: portalAccess.phone,
        locale: portalAccess.locale,
      })
      .from(portalAccess)
      .where(and(eq(portalAccess.caseId, caseId), isNull(portalAccess.revokedAt))),
  );
  return rows.map((r) => ({ ...r, locale: asLocale(r.locale) }));
}

async function done(db: Db, event: StoredEvent) {
  return withFirm(db, event.firmId!, (tx) =>
    handleOnce(tx, PORTAL_ALERTS_CONSUMER, event.id, async () => {}),
  );
}

const dueDate = (iso: string, locale: Locale) =>
  formatWhen(new Date(`${iso}T00:00:00Z`), locale, false);

/**
 * A message on the case thread. From the firm: each client gets an email and a text telling
 * them to open the portal. From a client: the assigned lawyer gets an email, and a text if
 * they asked for texts.
 */
export async function sendMessageAlert(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
) {
  if (event.type !== "messages.MessagePosted" || !event.firmId) return false;
  const p = (event as unknown as MessagePosted).payload;
  const firmId = event.firmId;
  const c = await withFirm(db, firmId, (tx) => findCase(tx, p.entityId));
  if (!c) return done(db, event);
  const base = { firmId, caseId: c.id };

  if (p.from === "firm") {
    const firmName = await getFirmName(db, firmId);
    const [author] = event.actorUserId ? await findUsersByIds(db, [event.actorUserId]) : [];
    for (const client of await clientsOf(db, firmId, c.id)) {
      const key = `message:${p.messageId}:${client.id}`;
      await deliver(db, notifier, {
        ...base,
        dedupeKey: `${key}:email`,
        channel: "email",
        to: client.email,
        template: "portal-message",
        locale: client.locale,
        data: {
          firmName,
          authorName: author?.name ?? firmName,
          caseReference: c.reference,
          link: `${appUrl}/portal`,
        },
      });
      await deliver(db, notifier, {
        ...base,
        dedupeKey: `${key}:sms`,
        channel: "sms",
        to: client.phone,
        template: "portal-message-sms",
        locale: client.locale,
        data: { firmName, caseReference: c.reference },
      });
    }
    return done(db, event);
  }

  const [lawyer] = c.assignedLawyerId ? await findUsersByIds(db, [c.assignedLawyerId]) : [];
  if (lawyer) {
    const locale = asLocale(lawyer.locale);
    const data = { clientName: p.client ?? "", caseReference: c.reference };
    await deliver(db, notifier, {
      ...base,
      userId: lawyer.id,
      dedupeKey: `message:${p.messageId}:lawyer:email`,
      channel: "email",
      to: lawyer.email,
      template: "client-message",
      locale,
      data: { ...data, link: `${appUrl}/cases/${c.id}` },
    });
    if (lawyer.smsReminders && lawyer.phone) {
      await deliver(db, notifier, {
        ...base,
        userId: lawyer.id,
        dedupeKey: `message:${p.messageId}:lawyer:sms`,
        channel: "sms",
        to: lawyer.phone,
        template: "client-message-sms",
        locale,
        data,
      });
    }
  }
  return done(db, event);
}

/** A new instalment on the schedule: each client gets an email with the amount and due date. */
export async function sendPaymentAddedAlert(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
) {
  if (event.type !== "payments.PaymentAdded" || !event.firmId) return false;
  const p = (event as unknown as PaymentAdded).payload;
  const firmId = event.firmId;
  const payment = await findPayment(db, firmId, p.paymentId);
  const c = await withFirm(db, firmId, (tx) => findCase(tx, p.entityId));
  if (!payment || !c) return done(db, event);
  const firmName = await getFirmName(db, firmId);
  for (const client of await clientsOf(db, firmId, c.id)) {
    await deliver(db, notifier, {
      firmId,
      caseId: c.id,
      dedupeKey: `payment-added:${payment.id}:${client.id}`,
      channel: "email",
      to: client.email,
      template: "portal-payment-added",
      locale: client.locale,
      data: {
        firmName,
        caseReference: c.reference,
        label: payment.label,
        amount: formatMoney(payment.amountMinor, payment.currency, client.locale),
        due: payment.dueOn ? dueDate(payment.dueOn, client.locale) : "",
        link: `${appUrl}/portal`,
      },
    });
  }
  return done(db, event);
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Reminds clients about unpaid instalments a week before they fall due and on the day, by
 * email and text. Run hourly with atLocalHour: each firm hears at that hour in its own time zone.
 */
export async function sendPaymentReminders(
  db: Db,
  notifier: Notifier,
  appUrl: string,
  clock: Clock = systemClock,
  options: { atLocalHour?: number } = {},
) {
  const now = clock.now();
  const zones = new Map((await listJurisdictions(db)).map((j) => [j.code, j.timezone]));
  let sent = 0;
  for (const { id: firmId, jurisdictionCode } of await listFirmJurisdictions(db)) {
    const timeZone = zones.get(jurisdictionCode) ?? "UTC";
    if (options.atLocalHour !== undefined && localHour(now, timeZone) !== options.atLocalHour)
      continue;
    const today = localDay(now, timeZone);
    const inAWeek = addDays(today, 7);
    const due = await listPaymentsDueOn(db, firmId, [today, inAWeek]);
    if (due.length === 0) continue;
    const firmName = await getFirmName(db, firmId);
    for (const payment of due) {
      const when = payment.dueOn === today ? ("today" as const) : ("week" as const);
      const c = await withFirm(db, firmId, (tx) => findCase(tx, payment.caseId));
      if (!c || c.status === "completed" || c.status === "cancelled") continue;
      for (const client of await clientsOf(db, firmId, c.id)) {
        const key = `payment-due:${payment.id}:${payment.dueOn}:${when}:${client.id}`;
        const amount = formatMoney(payment.amountMinor, payment.currency, client.locale);
        const dueOn = dueDate(payment.dueOn!, client.locale);
        const results = [
          await deliver(db, notifier, {
            firmId,
            caseId: c.id,
            dedupeKey: `${key}:email`,
            channel: "email",
            to: client.email,
            template: "portal-payment-due",
            locale: client.locale,
            data: {
              firmName,
              caseReference: c.reference,
              label: payment.label,
              amount,
              due: dueOn,
              when,
              payTo: payment.payTo ?? "",
              link: `${appUrl}/portal`,
            },
          }),
          await deliver(db, notifier, {
            firmId,
            caseId: c.id,
            dedupeKey: `${key}:sms`,
            channel: "sms",
            to: client.phone,
            template: "portal-payment-due-sms",
            locale: client.locale,
            data: { caseReference: c.reference, label: payment.label, amount, due: dueOn, when },
          }),
        ];
        sent += results.filter((r) => r === "sent").length;
      }
    }
  }
  return { sent };
}
