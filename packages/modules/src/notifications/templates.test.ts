import { describe, expect, it } from "vitest";
import { createBrevoNotifier } from "./brevo.ts";
import { LOCALES, render, type TemplateData, type TemplateName } from "./templates.ts";

const SAMPLES: { [K in TemplateName]: TemplateData[K] } = {
  "firm-invitation": {
    firmName: "Christou & Co",
    inviterName: "Elena",
    role: "lawyer",
    link: "https://x/i",
  },
  "deadline-reminder": {
    title: "Sign contract",
    caseReference: "CY-2026-001",
    due: "13 Oct",
    link: "https://x/c",
  },
  "deadline-reminder-sms": { title: "Sign contract", caseReference: "CY-2026-001", due: "13 Oct" },
  "document-expiring": {
    title: "Search certificate",
    caseReference: "CY-2026-001",
    state: "expiring",
    date: "20 Oct",
    link: "https://x/c",
  },
  "daily-digest": {
    name: "Elena",
    overdue: [],
    upcoming: [{ caseReference: "CY-2026-001", title: "Sign contract", when: "13 Oct" }],
    documents: [],
    gaps: [{ caseReference: "CY-2026-001", count: 3 }],
    link: "https://x",
  },
};

describe("templates", () => {
  it("renders every template in every language with the case reference", () => {
    for (const name of Object.keys(SAMPLES) as TemplateName[]) {
      const texts = LOCALES.map((locale) => render(name, locale, SAMPLES[name] as never).text);
      expect(new Set(texts).size).toBe(LOCALES.length);
      if (name !== "firm-invitation") for (const t of texts) expect(t).toContain("CY-2026-001");
    }
  });

  it("keeps the SMS reminder within one message", () => {
    for (const locale of LOCALES) {
      expect(
        render("deadline-reminder-sms", locale, SAMPLES["deadline-reminder-sms"]).text.length,
      ).toBeLessThanOrEqual(160);
    }
  });

  it("leaves empty digest sections out", () => {
    const text = render("daily-digest", "en", SAMPLES["daily-digest"]).text;
    expect(text).toContain("Due in the next 7 days");
    expect(text).not.toContain("Overdue");
  });
});

describe("Brevo notifier", () => {
  function fakeFetch(status = 201) {
    const calls: { url: string; body: Record<string, unknown>; key: string }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)),
        key: (init.headers as Record<string, string>)["api-key"]!,
      });
      return new Response(JSON.stringify({ messageId: "m-1" }), { status });
    }) as unknown as typeof fetch;
    return { calls, fn };
  }
  const config = {
    apiKey: "k",
    sender: { name: "Kleidi", email: "no-reply@kleidi.cy" },
    smsSender: "Kleidi",
  };

  it("sends email and SMS to the transactional endpoints", async () => {
    const { calls, fn } = fakeFetch();
    const brevo = createBrevoNotifier({ ...config, fetch: fn });
    await brevo.send({
      channel: "email",
      to: "a@b.cy",
      template: "deadline-reminder",
      locale: "el",
      data: SAMPLES["deadline-reminder"],
    });
    await brevo.send({
      channel: "sms",
      to: "+35799123456",
      template: "deadline-reminder-sms",
      locale: "en",
      data: SAMPLES["deadline-reminder-sms"],
    });
    expect(calls[0]).toMatchObject({
      url: "https://api.brevo.com/v3/smtp/email",
      key: "k",
      body: { to: [{ email: "a@b.cy" }] },
    });
    expect(String(calls[0]!.body.subject)).toContain("Υπενθύμιση");
    expect(calls[1]).toMatchObject({
      url: "https://api.brevo.com/v3/transactionalSMS/send",
      body: { recipient: "+35799123456", sender: "Kleidi", type: "transactional" },
    });
  });

  it("throws on an error answer so the job retries", async () => {
    const brevo = createBrevoNotifier({ ...config, fetch: fakeFetch(500).fn });
    await expect(
      brevo.send({
        channel: "email",
        to: "a@b.cy",
        template: "deadline-reminder",
        locale: "en",
        data: SAMPLES["deadline-reminder"],
      }),
    ).rejects.toThrow(/500/);
  });
});
