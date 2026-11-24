import type { Db } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import { AUDIT_CONSUMER, recordAuditFromEvent } from "@kleidi/modules/audit";
import {
  scanUploadedVersion,
  SCANNER_CONSUMER,
  type ObjectStore,
  type Scanner,
} from "@kleidi/modules/documents";
import {
  NOTIFICATIONS_CONSUMER,
  sendDeadlineReminder,
  sendExpiryAlert,
  sendInvitationEmail,
  type Notifier,
} from "@kleidi/modules/notifications";
import {
  PORTAL_ALERTS_CONSUMER,
  sendMessageAlert,
  sendPaymentAddedAlert,
} from "@kleidi/modules/portal";

export type Consumer = {
  name: string;
  accepts: (type: string) => boolean;
  handle: (event: StoredEvent) => Promise<unknown>;
};

const SENDERS = {
  "firms.MemberInvited": sendInvitationEmail,
  "deadlines.ReminderDue": sendDeadlineReminder,
  "documents.ExpiryFlagged": sendExpiryAlert,
} as const;
const notified = (type: string): type is keyof typeof SENDERS => type in SENDERS;

// Alerts to clients (and to the lawyer when a client writes) about the thread and the schedule.
const ALERTS = {
  "messages.MessagePosted": sendMessageAlert,
  "payments.PaymentAdded": sendPaymentAddedAlert,
} as const;
const alerted = (type: string): type is keyof typeof ALERTS => type in ALERTS;

/** Which module reacts to which event. Every firm event also lands in the audit trail. */
export function buildConsumers(deps: {
  db: Db;
  notifier: Notifier;
  appUrl: string;
  store: ObjectStore;
  scanner: Scanner;
}): Consumer[] {
  return [
    { name: AUDIT_CONSUMER, accepts: () => true, handle: (e) => recordAuditFromEvent(deps.db, e) },
    {
      name: SCANNER_CONSUMER,
      accepts: (type) => type === "documents.VersionUploaded",
      handle: (e) => scanUploadedVersion(deps.db, deps.store, deps.scanner, e),
    },
    {
      name: NOTIFICATIONS_CONSUMER,
      accepts: notified,
      handle: (e) =>
        notified(e.type)
          ? SENDERS[e.type](deps.db, deps.notifier, e, deps.appUrl)
          : Promise.resolve(false),
    },
    {
      name: PORTAL_ALERTS_CONSUMER,
      accepts: alerted,
      handle: (e) =>
        alerted(e.type)
          ? ALERTS[e.type](deps.db, deps.notifier, e, deps.appUrl)
          : Promise.resolve(false),
    },
  ];
}

export const queueFor = (consumer: string) => `events.${consumer}`;
