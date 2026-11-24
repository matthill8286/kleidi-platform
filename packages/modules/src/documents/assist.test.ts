import { describe, expect, it } from "vitest";
import { createAssistClient } from "./assist.ts";

const explanation = {
  title_status: "trapped",
  plain_english_summary: "The developer still owns the land.",
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("Kleidi Assist client", () => {
  it("sends the document with the API key and returns the explanation", async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      explanation,
      markdown: "# Explained",
      model: "gpt-test",
    });
    const assist = createAssistClient({ url: "http://assist.local/", apiKey: "k1", fetchImpl });
    const result = await assist.explainCyprus({
      document: { name: "search.pdf", mediaType: "application/pdf", bytes: Buffer.from("%PDF") },
      question: "Can I get my deed?",
    });
    expect(calls[0]!.url).toBe("http://assist.local/api/v1/cyprus/explain");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer k1");
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toEqual({
      document: {
        name: "search.pdf",
        mediaType: "application/pdf",
        data: Buffer.from("%PDF").toString("base64"),
      },
      question: "Can I get my deed?",
    });
    expect(result).toEqual({ explanation, markdown: "# Explained", model: "gpt-test" });
  });

  it("leaves the question out when there is none", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { explanation, markdown: "", model: "m" });
    await createAssistClient({ url: "http://assist.local", fetchImpl }).explainCyprus({
      document: { name: "a.txt", mediaType: "text/plain", bytes: Buffer.from("x") },
    });
    expect(JSON.parse(String(calls[0]!.init.body))).not.toHaveProperty("question");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("turns a failed review into a readable unavailable error", async () => {
    const { fetchImpl } = fakeFetch(502, { error: "The model declined to review this document." });
    const assist = createAssistClient({ url: "http://assist.local", fetchImpl });
    await expect(
      assist.explainCyprus({
        document: { name: "a.pdf", mediaType: "application/pdf", bytes: Buffer.from("x") },
      }),
    ).rejects.toMatchObject({ code: "unavailable", status: 503, key: "assistFailed" });
  });

  it("sends a lease for review with what the buyer said", async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      review: { flags: [] },
      report: "# Report",
      buyerSummary: "## Your lease",
      model: "gpt-test",
    });
    const result = await createAssistClient({ url: "http://assist.local", fetchImpl }).reviewLease({
      document: { name: "lease.pdf", mediaType: "application/pdf", bytes: Buffer.from("%PDF") },
      buyer: { plansToLet: true },
    });
    expect(calls[0]!.url).toBe("http://assist.local/api/v1/leases/review");
    expect(JSON.parse(String(calls[0]!.init.body)).buyer).toEqual({ plansToLet: true });
    expect(result).toEqual({
      review: { flags: [] },
      report: "# Report",
      buyerSummary: "## Your lease",
      model: "gpt-test",
    });
  });

  it("asks for translations", async () => {
    const { fetchImpl, calls } = fakeFetch(200, {
      translations: { el: "Γεια", ru: "Привет" },
      model: "m",
    });
    const result = await createAssistClient({ url: "http://assist.local", fetchImpl }).translate({
      text: "Hello",
      to: ["el", "ru"],
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ text: "Hello", to: ["el", "ru"] });
    expect(result).toEqual({ translations: { el: "Γεια", ru: "Привет" } });
  });

  it("turns a failed lease review into an Assist error", async () => {
    const { fetchImpl } = fakeFetch(502, { error: "The model declined" });
    await expect(
      createAssistClient({ url: "http://assist.local", fetchImpl }).reviewLease({
        document: { name: "l.pdf", mediaType: "application/pdf", bytes: Buffer.from("x") },
        buyer: {},
      }),
    ).rejects.toMatchObject({ key: "assistFailed", message: "The model declined" });
  });
});
