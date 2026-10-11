export { NOTIFICATIONS_CONSUMER, sendDeadlineReminder, sendInvitationEmail } from "./handlers.ts";
export type { Notifier, OutboundMessage } from "./notifier.ts";
export { createSmtpNotifier } from "./smtp.ts";
export { render, type Locale, type TemplateName } from "./templates.ts";
