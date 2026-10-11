import type { Locale, TemplateName } from "./templates.ts";

export type OutboundMessage = {
  channel: "email" | "sms";
  to: string;
  template: TemplateName;
  locale: Locale;
  data: Record<string, string>;
};

/** Implemented by Brevo in production and SMTP to Mailpit locally. */
export interface Notifier {
  send(message: OutboundMessage): Promise<{ providerId: string }>;
}
