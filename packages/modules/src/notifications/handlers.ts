import { eq } from "drizzle-orm";
import { handleOnce, withFirm, type Db } from "@kleidi/db";
import { notifications } from "@kleidi/db/schema/notifications";
import type { StoredEvent } from "@kleidi/kernel";
import { findUsersByIds } from "../identity/index.ts";
import type { Notifier } from "./notifier.ts";
import type { Locale } from "./templates.ts";

export const NOTIFICATIONS_CONSUMER = "notifications";

type InvitedPayload = {
  email: string;
  token: string;
  firmName: string;
  inviterName: string;
  role: string;
};

/**
 * Emails an invitation link. Runs once per event: if sending throws, the transaction rolls
 * back and the job is retried.
 */
export async function sendInvitationEmail(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
): Promise<boolean> {
  if (event.type !== "firms.MemberInvited" || !event.firmId) return false;
  const p = event.payload as InvitedPayload;
  return withFirm(db, event.firmId, (tx) =>
    handleOnce(tx, NOTIFICATIONS_CONSUMER, event.id, async () => {
      const [row] = await tx
        .insert(notifications)
        .values({
          firmId: event.firmId!,
          channel: "email",
          template: "firm-invitation",
          recipient: p.email,
          dedupeKey: `invitation:${event.id}`,
        })
        .returning({ id: notifications.id });
      await notifier.send({
        channel: "email",
        to: p.email,
        template: "firm-invitation",
        locale: "en",
        data: {
          firmName: p.firmName,
          inviterName: p.inviterName,
          role: p.role,
          link: `${appUrl}/invite/${encodeURIComponent(p.token)}`,
        },
      });
      await tx
        .update(notifications)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(notifications.id, row!.id));
    }),
  );
}

type ReminderPayload = { caseId: string; title: string; dueAt: string; ownerId: string };

const LOCALES: Locale[] = ["en", "el", "ru"];
const formatDue = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleString(locale === "el" ? "el-GR" : locale === "ru" ? "ru-RU" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Nicosia",
  });

/** Emails the deadline owner in their own language. */
export async function sendDeadlineReminder(
  db: Db,
  notifier: Notifier,
  event: StoredEvent,
  appUrl: string,
): Promise<boolean> {
  if (event.type !== "deadlines.ReminderDue" || !event.firmId) return false;
  const p = event.payload as ReminderPayload;
  const [owner] = await findUsersByIds(db, [p.ownerId]);
  if (!owner) return false;
  const locale = (LOCALES as string[]).includes(owner.locale) ? (owner.locale as Locale) : "en";
  return withFirm(db, event.firmId, (tx) =>
    handleOnce(tx, NOTIFICATIONS_CONSUMER, event.id, async () => {
      const [row] = await tx
        .insert(notifications)
        .values({
          firmId: event.firmId!,
          caseId: p.caseId,
          channel: "email",
          template: "deadline-reminder",
          recipient: owner.email,
          dedupeKey: `reminder:${event.id}`,
        })
        .returning({ id: notifications.id });
      await notifier.send({
        channel: "email",
        to: owner.email,
        template: "deadline-reminder",
        locale,
        data: {
          title: p.title,
          due: formatDue(p.dueAt, locale),
          link: `${appUrl}/cases/${p.caseId}`,
        },
      });
      await tx
        .update(notifications)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(notifications.id, row!.id));
    }),
  );
}
