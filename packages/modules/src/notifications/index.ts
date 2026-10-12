export { createBrevoNotifier, type BrevoConfig } from "./brevo.ts";
export {
  deliver,
  NOTIFICATIONS_CONSUMER,
  sendDailyDigests,
  sendDeadlineReminder,
  sendExpiryAlert,
  sendInvitationEmail,
} from "./handlers.ts";
export { renderMessage, routeByChannel, type Notifier, type OutboundMessage } from "./notifier.ts";
export { createSmtpNotifier } from "./smtp.ts";
export { asLocale, formatWhen, render, type Locale, type TemplateName } from "./templates.ts";
