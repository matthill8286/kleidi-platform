import type { Db } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import { AUDIT_CONSUMER, recordAuditFromEvent } from "@kleidi/modules/audit";
import {
  NOTIFICATIONS_CONSUMER,
  sendDeadlineReminder,
  sendInvitationEmail,
  type Notifier,
} from "@kleidi/modules/notifications";

export type Consumer = {
  name: string;
  accepts: (type: string) => boolean;
  handle: (event: StoredEvent) => Promise<unknown>;
};

const NOTIFIED = new Set(["firms.MemberInvited", "deadlines.ReminderDue"]);

/** Which module reacts to which event. Every firm event also lands in the audit trail. */
export function buildConsumers(deps: { db: Db; notifier: Notifier; appUrl: string }): Consumer[] {
  return [
    { name: AUDIT_CONSUMER, accepts: () => true, handle: (e) => recordAuditFromEvent(deps.db, e) },
    {
      name: NOTIFICATIONS_CONSUMER,
      accepts: (type) => NOTIFIED.has(type),
      handle: (e) =>
        e.type === "firms.MemberInvited"
          ? sendInvitationEmail(deps.db, deps.notifier, e, deps.appUrl)
          : sendDeadlineReminder(deps.db, deps.notifier, e, deps.appUrl),
    },
  ];
}

export const queueFor = (consumer: string) => `events.${consumer}`;
