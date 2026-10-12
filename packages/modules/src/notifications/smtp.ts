import nodemailer from "nodemailer";
import { renderMessage, type Notifier } from "./notifier.ts";

/**
 * Local stand-in for Brevo. Email goes to Mailpit as is; an SMS arrives in Mailpit as an
 * email to sms+<number>@kleidi.local, so developers can read both in one place.
 */
export function createSmtpNotifier(options: {
  host: string;
  port: number;
  from: string;
}): Notifier {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
  });
  return {
    async send(message) {
      const { subject, text } = renderMessage(message);
      const sms = message.channel === "sms";
      const info = await transport.sendMail({
        from: options.from,
        to: sms ? `sms+${message.to.replace(/\D/g, "")}@kleidi.local` : message.to,
        subject: sms ? `SMS to ${message.to}` : subject,
        text,
      });
      return { providerId: info.messageId };
    },
  };
}
