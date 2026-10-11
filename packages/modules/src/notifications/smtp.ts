import nodemailer from "nodemailer";
import type { Notifier } from "./notifier.ts";
import { render } from "./templates.ts";

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
      if (message.channel !== "email") throw new Error("The SMTP notifier only sends email");
      const { subject, text } = render(message.template, message.locale, message.data);
      const info = await transport.sendMail({ from: options.from, to: message.to, subject, text });
      return { providerId: info.messageId };
    },
  };
}
