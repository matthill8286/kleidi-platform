import { renderMessage, type Notifier } from "./notifier.ts";

export type BrevoConfig = {
  apiKey: string;
  sender: { name: string; email: string };
  // Up to 11 letters and digits, shown as the SMS sender.
  smsSender: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

/**
 * Brevo transactional email and SMS (EU-hosted). A non-2xx answer throws, so the job is
 * retried; Brevo's message id is kept on the notification row.
 */
export function createBrevoNotifier(config: BrevoConfig): Notifier {
  const http = config.fetch ?? fetch;
  const base = config.baseUrl ?? "https://api.brevo.com/v3";

  async function post(path: string, body: unknown): Promise<string> {
    const res = await http(`${base}${path}`, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Brevo ${path} answered ${res.status}: ${text.slice(0, 300)}`);
    const json = (text ? JSON.parse(text) : {}) as {
      messageId?: string | number;
      reference?: string;
    };
    return String(json.messageId ?? json.reference ?? "");
  }

  return {
    async send(message) {
      const { subject, text } = renderMessage(message);
      if (message.channel === "sms") {
        const providerId = await post("/transactionalSMS/send", {
          sender: config.smsSender,
          recipient: message.to,
          content: text,
          type: "transactional",
          tag: message.template,
        });
        return { providerId };
      }
      const providerId = await post("/smtp/email", {
        sender: config.sender,
        to: [{ email: message.to }],
        subject,
        textContent: text,
        tags: [message.template],
      });
      return { providerId };
    },
  };
}
