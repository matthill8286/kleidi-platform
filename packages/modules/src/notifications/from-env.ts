import { createBrevoNotifier } from "./brevo.ts";
import type { Notifier } from "./notifier.ts";
import { createSmtpNotifier } from "./smtp.ts";

/** Brevo when a key is set (staging and production); otherwise everything lands in Mailpit. */
export function createNotifierFromEnv(env: Record<string, string | undefined>): Notifier {
  if (env.BREVO_API_KEY) {
    return createBrevoNotifier({
      apiKey: env.BREVO_API_KEY,
      sender: {
        name: env.BREVO_SENDER_NAME ?? "Kleidi",
        email: env.BREVO_SENDER_EMAIL ?? "no-reply@kleidi.cy",
      },
      smsSender: env.BREVO_SMS_SENDER ?? "Kleidi",
    });
  }
  return createSmtpNotifier({
    host: env.SMTP_HOST ?? "localhost",
    port: Number(env.SMTP_PORT ?? 1025),
    from: env.MAIL_FROM ?? "Kleidi <no-reply@kleidi.local>",
  });
}
