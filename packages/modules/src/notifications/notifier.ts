import {
  render,
  type Locale,
  type Rendered,
  type TemplateData,
  type TemplateName,
} from "./templates.ts";

export type OutboundMessage = {
  [K in TemplateName]: {
    channel: "email" | "sms";
    to: string;
    template: K;
    locale: Locale;
    data: TemplateData[K];
  };
}[TemplateName];

/** Implemented by Brevo in production and by Mailpit locally. */
export interface Notifier {
  send(message: OutboundMessage): Promise<{ providerId: string }>;
}

/** Sends email through one notifier and SMS through another. */
export function routeByChannel(channels: { email: Notifier; sms: Notifier }): Notifier {
  return { send: (message) => channels[message.channel].send(message) };
}

export const renderMessage = (m: OutboundMessage): Rendered =>
  render(m.template, m.locale, m.data as never);
