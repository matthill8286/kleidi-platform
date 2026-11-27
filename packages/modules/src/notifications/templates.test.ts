import { describe, expect, it } from "vitest";
import { createBrevoNotifier } from "./brevo.ts";
import { formatMoney, LOCALES, render, type TemplateData, type TemplateName } from "./templates.ts";

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
  "portal-invitation": {
    firmName: "Christou & Co",
    lawyerName: "Elena",
    caseReference: "CY-2026-001",
    link: "https://x/p",
  },
  "portal-sign-in": { firmName: "Christou & Co", link: "https://x/p" },
  "portal-code": { code: "123456" },
  "portal-message": {
    firmName: "Christou & Co",
    authorName: "Elena",
    caseReference: "CY-2026-001",
    link: "https://x/p",
  },
  "portal-message-sms": { firmName: "Christou & Co", caseReference: "CY-2026-001" },
  "client-message": { clientName: "James Hart", caseReference: "CY-2026-001", link: "https://x/c" },
  "client-message-sms": { clientName: "James Hart", caseReference: "CY-2026-001" },
  "portal-payment-added": {
    firmName: "Christou & Co",
    caseReference: "CY-2026-001",
    label: "Deposit",
    amount: "€30,000.00",
    due: "15 Feb 2027",
    link: "https://x/p",
  },
  "portal-payment-due": {
    firmName: "Christou & Co",
    caseReference: "CY-2026-001",
    label: "Deposit",
    amount: "€30,000.00",
    due: "15 Feb 2027",
    when: "week",
    payTo: "Developer's account",
    link: "https://x/p",
  },
  "portal-payment-due-sms": {
    caseReference: "CY-2026-001",
    label: "Deposit",
    amount: "€30,000.00",
    due: "15 Feb 2027",
    when: "today",
  },
  "verify-email": { name: "Elena", link: "https://x/v" },
  "reset-password": { name: "Elena", link: "https://x/r" },
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
      if (
        name.startsWith("deadline") ||
        name.startsWith("document") ||
        name === "daily-digest" ||
        name === "portal-invitation" ||
        name.startsWith("portal-message") ||
        name.startsWith("portal-payment") ||
        name.startsWith("client-message")
      )
        for (const t of texts) expect(t).toContain("CY-2026-001");
    }
  });

  it("keeps every SMS within one message", () => {
    const sms = (Object.keys(SAMPLES) as TemplateName[]).filter((n) => n.endsWith("-sms"));
    expect(sms.length).toBeGreaterThan(1);
    for (const name of sms)
      for (const locale of LOCALES)
        expect(
          render(name, locale, SAMPLES[name] as never).text.length,
          `${name} ${locale}`,
        ).toBeLessThanOrEqual(160);
  });

  it("formats money in the reader's language", () => {
    expect(formatMoney(3000000, "EUR", "en")).toBe("€30,000.00");
    expect(formatMoney(125050, "GBP", "en")).toBe("£1,250.50");
    expect(formatMoney(3000000, "EUR", "el")).toMatch(/30\.000,00/);
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
