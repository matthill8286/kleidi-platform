import { and, eq } from "drizzle-orm";
import { handleOnce, withFirm, type Db } from "@kleidi/db";
import { notifications } from "@kleidi/db/schema/notifications";
import { systemClock, type Clock, type StoredEvent } from "@kleidi/kernel";
import { findCase, findCasesByIds } from "../cases/index.ts";
import { listDeadlines, type ReminderDue } from "../deadlines/index.ts";
import { listAttentionDocuments, listStageGaps } from "../documents/index.ts";
import { listFirmIds, listTeam } from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import { getTemplate } from "../jurisdictions/index.ts";
import type { Notifier, OutboundMessage } from "./notifier.ts";
import {
  asLocale,
  DOCUMENT_STATES,
  formatWhen,
  type DigestLine,
  type Locale,
} from "./templates.ts";

export const NOTIFICATIONS_CONSUMER = "notifications";

type Delivery = OutboundMessage & {
  firmId: string;
  caseId?: string | null;
  userId?: string | null;
  // One row per key: a retried job finds the row already sent and stops.
  dedupeKey: string;
};

/**
 * Sends one message at most once. The claim commits before sending, so a message that was
 * sent is never sent again, even when a later step of the same job fails and retries.
 */
export async function deliver(db: Db, notifier: Notifier, d: Delivery, clock: Clock = systemClock) {
  const claim = await withFirm(db, d.firmId, async (tx) => {
    await tx
      .insert(notifications)
      .values({
        firmId: d.firmId,
        caseId: d.caseId ?? null,
        userId: d.userId ?? null,
        channel: d.channel,
        template: d.template,
        recipient: d.to,
        locale: d.locale,
        dedupeKey: d.dedupeKey,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, d.dedupeKey));
    return row!;
  });
  if (claim.status === "sent") return "already_sent" as const;

  const { firmId: _f, caseId: _c, userId: _u, dedupeKey: _k, ...message } = d;
  try {
    const { providerId } = await notifier.send(message as OutboundMessage);
    await withFirm(db, d.firmId, (tx) =>
      tx
        .update(notifications)
        .set({ status: "sent", sentAt: clock.now(), providerId, error: null })
        .where(eq(notifications.id, claim.id)),
    );
    return "sent" as const;
  } catch (error) {
    await withFirm(db, d.firmId, (tx) =>
      tx
        .update(notifications)
        .set({ status: "failed", error: String(error).slice(0, 500) })
        .where(and(eq(notifications.id, claim.id), eq(notifications.status, "queued"))),
    );
    throw error;
  }
}

/** Marks the event handled once every message for it went out. */
async function finish(db: Db, event: StoredEvent) {
  return withFirm(db, event.firmId!, (tx) =>
    handleOnce(tx, NOTIFICATIONS_CONSUMER, event.id, async () => {}),
  );
}

async function localeOf(db: Db, userId: string | null): Promise<Locale> {
  if (!userId) return "en";
  const [user] = await findUsersByIds(db, [userId]);
  return asLocale(user?.locale);
}

/** A checklist item's title in the reader's language; ad-hoc titles stay as typed. */
async function documentTitle(
  db: Db,
  jurisdiction: string,
  requirementKey: string | null,
  title: string,
  locale: Locale,
) {
  if (!requirementKey) return title;
  const template = await getTemplate(db, jurisdiction);
  return template.requirements.find((r) => r.key === requirementKey)?.label[locale] ?? title;
}

type InvitedPayload = {
  email: string;
  token: string;
  firmName: string;
  inviterName: string;
  role: string;
};

/** The invitation goes out in the inviter's language; the invitee can switch after joining. */
export async function sendInvitationEmail(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
) {
  if (event.type !== "firms.MemberInvited" || !event.firmId) return false;
  const p = event.payload as InvitedPayload;
  await deliver(db, notifier, {
    firmId: event.firmId,
    dedupeKey: `invitation:${event.id}`,
    channel: "email",
    to: p.email,
    template: "firm-invitation",
    locale: await localeOf(db, event.actorUserId),
    data: {
      firmName: p.firmName,
      inviterName: p.inviterName,
      role: p.role,
      link: `${appUrl}/invite/${encodeURIComponent(p.token)}`,
    },
  });
  return finish(db, event);
}

/** Emails the owner in their own language, and texts them too for the last day if they asked. */
export async function sendDeadlineReminder(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
) {
  if (event.type !== "deadlines.ReminderDue" || !event.firmId) return false;
  const p = (event as unknown as ReminderDue).payload;
  const [owner] = await findUsersByIds(db, [p.ownerId]);
  if (!owner) return finish(db, event);
  const locale = asLocale(owner.locale);
  const c = await withFirm(db, event.firmId, (tx) => findCase(tx, p.caseId));
  const caseReference = c?.reference ?? "";
  const due = formatWhen(new Date(p.dueAt), locale);
  const base = { firmId: event.firmId, caseId: p.caseId, userId: owner.id, locale };

  await deliver(db, notifier, {
    ...base,
    dedupeKey: `reminder:${event.id}:email`,
    channel: "email",
    to: owner.email,
    template: "deadline-reminder",
    data: { title: p.title, caseReference, due, link: `${appUrl}/cases/${p.caseId}` },
  });
  if (owner.smsReminders && owner.phone && p.hoursBefore <= 24) {
    await deliver(db, notifier, {
      ...base,
      dedupeKey: `reminder:${event.id}:sms`,
      channel: "sms",
      to: owner.phone,
      template: "deadline-reminder-sms",
      data: { title: p.title, caseReference, due },
    });
  }
  return finish(db, event);
}

type ExpiryPayload = {
  entityId: string;
  requirementKey: string | null;
  title: string;
  state: "expiring" | "expired";
  expiresOn: string;
};

/** Tells the case's lawyer that a document is about to go stale, or has. */
export async function sendExpiryAlert(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
) {
  if (event.type !== "documents.ExpiryFlagged" || !event.firmId) return false;
  const p = event.payload as ExpiryPayload;
  const c = await withFirm(db, event.firmId, (tx) => findCase(tx, p.entityId));
  const [lawyer] = c?.assignedLawyerId ? await findUsersByIds(db, [c.assignedLawyerId]) : [];
  if (!c || !lawyer) return finish(db, event);
  const locale = asLocale(lawyer.locale);
  await deliver(db, notifier, {
    firmId: event.firmId,
    caseId: c.id,
    userId: lawyer.id,
    dedupeKey: `expiry:${event.id}`,
    channel: "email",
    to: lawyer.email,
    template: "document-expiring",
    locale,
    data: {
      title: await documentTitle(db, c.jurisdictionCode, p.requirementKey, p.title, locale),
      caseReference: c.reference,
      state: p.state,
      date: formatWhen(new Date(`${p.expiresOn}T00:00:00Z`), locale, false),
      link: `${appUrl}/cases/${c.id}`,
    },
  });
  return finish(db, event);
}

/**
 * One morning email per member per firm: their overdue and upcoming deadlines, and the
 * documents needing attention on their cases. Nobody gets an empty digest.
 */
export async function sendDailyDigests(
  db: Db,
  notifier: Notifier,
  appUrl: string,
  clock: Clock = systemClock,
) {
  const now = clock.now();
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Nicosia" });
  let sent = 0;
  for (const firmId of await listFirmIds(db)) {
    const [team, open, attention, stageGaps] = await Promise.all([
      listTeam(db, firmId),
      listDeadlines(db, firmId, {}, clock),
      listAttentionDocuments(db, firmId),
      listStageGaps(db, firmId),
    ]);
    const cases = new Map(
      (
        await withFirm(db, firmId, (tx) =>
          findCasesByIds(tx, [...new Set(attention.map((d) => d.caseId))]),
        )
      ).map((c) => [c.id, c]),
    );
    const members = await findUsersByIds(
      db,
      team.members.map((m) => m.userId),
    );

    for (const member of members) {
      const locale = asLocale(member.locale);
      const mine = open.filter((d) => d.owner?.id === member.id);
      const line = (d: (typeof mine)[number]): DigestLine => ({
        caseReference: d.caseReference,
        title: d.title,
        when: formatWhen(d.dueAt, locale),
      });
      const overdue = mine.filter((d) => d.urgency === "overdue").map(line);
      const upcoming = mine.filter((d) => d.urgency === "today" || d.urgency === "week").map(line);
      const documents: DigestLine[] = [];
      for (const doc of attention) {
        const c = cases.get(doc.caseId);
        if (!c || c.assignedLawyerId !== member.id) continue;
        documents.push({
          caseReference: c.reference,
          title: await documentTitle(db, c.jurisdictionCode, doc.requirementKey, doc.title, locale),
          // Why it needs attention, with the date for expiry.
          when: [
            DOCUMENT_STATES[locale][doc.state],
            doc.state === "expiring" || doc.state === "expired"
              ? formatWhen(new Date(`${doc.expiresOn}T00:00:00Z`), locale, false)
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
      }
      const gaps = stageGaps
        .filter((g) => g.assignedLawyerId === member.id)
        .map((g) => ({ caseReference: g.reference, count: g.count }));
      if (overdue.length + upcoming.length + documents.length + gaps.length === 0) continue;

      const result = await deliver(db, notifier, {
        firmId,
        userId: member.id,
        dedupeKey: `digest:${firmId}:${member.id}:${day}`,
        channel: "email",
        to: member.email,
        template: "daily-digest",
        locale,
        data: {
          name: member.name.split(" ")[0] ?? member.name,
          overdue,
          upcoming,
          documents,
          gaps,
          link: appUrl,
        },
      });
      if (result === "sent") sent += 1;
    }
  }
  return sent;
}
