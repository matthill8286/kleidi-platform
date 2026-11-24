import { AppError } from "@kleidi/kernel";

/** One file for Kleidi Assist: its bytes and how to read them. */
export type AssistDocument = { name: string; mediaType: string; bytes: Buffer };

export type CyprusExplanationResult = {
  explanation: Record<string, unknown>;
  markdown: string;
  model: string;
};

/** What the buyer has told the lawyer, which changes the lease flags. */
export type LeaseBuyer = {
  plansToLet?: boolean | undefined;
  propertyValue?: number | undefined;
  inLondon?: boolean | undefined;
};

export type LeaseReviewResult = {
  review: Record<string, unknown>;
  report: string;
  buyerSummary: string;
  model: string;
};

export type TranslationLocale = "el" | "ru";

/** The Kleidi Assist service, behind an interface so tests can stand in for it. */
export type Assist = {
  explainCyprus(input: {
    document: AssistDocument;
    question?: string | undefined;
  }): Promise<CyprusExplanationResult>;
  reviewLease(input: { document: AssistDocument; buyer: LeaseBuyer }): Promise<LeaseReviewResult>;
  translate(input: {
    text: string;
    to: TranslationLocale[];
  }): Promise<{ translations: Partial<Record<TranslationLocale, string>> }>;
};

/** File types the explainer reads. Word files would need converting first. */
export const EXPLAINABLE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
]);

const asDoc = (d: AssistDocument) => ({
  name: d.name,
  mediaType: d.mediaType,
  data: d.bytes.toString("base64"),
});

/** An HTTP client for Kleidi Assist. The API key is sent as a bearer token when set. */
export function createAssistClient(config: {
  url: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
}): Assist {
  const base = config.url.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;

  async function post<T>(path: string, body: unknown, check: (b: T) => boolean): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        // A review reads the whole document, so it can take a couple of minutes.
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new AppError("unavailable", "Kleidi Assist could not be reached", "assistFailed");
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok || !check(json)) {
      throw new AppError(
        "unavailable",
        json.error ?? `Kleidi Assist answered ${res.status}`,
        "assistFailed",
      );
    }
    return json;
  }

  return {
    async explainCyprus({ document, question }) {
      const body = await post<Partial<CyprusExplanationResult>>(
        "/api/v1/cyprus/explain",
        { document: asDoc(document), ...(question ? { question } : {}) },
        (b) => Boolean(b.explanation),
      );
      return {
        explanation: body.explanation!,
        markdown: body.markdown ?? "",
        model: body.model ?? "",
      };
    },
    async reviewLease({ document, buyer }) {
      const body = await post<Partial<LeaseReviewResult>>(
        "/api/v1/leases/review",
        { lease: asDoc(document), buyer },
        (b) => Boolean(b.review && b.report && b.buyerSummary),
      );
      return {
        review: body.review!,
        report: body.report!,
        buyerSummary: body.buyerSummary!,
        model: body.model ?? "",
      };
    },
    async translate({ text, to }) {
      const body = await post<{ translations?: Partial<Record<TranslationLocale, string>> }>(
        "/api/v1/translate",
        { text, to },
        (b) => Boolean(b.translations),
      );
      return { translations: body.translations! };
    },
  };
}
