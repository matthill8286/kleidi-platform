import { AppError } from "@kleidi/kernel";

/** One file for Kleidi Assist: its bytes and how to read them. */
export type AssistDocument = { name: string; mediaType: string; bytes: Buffer };

export type CyprusExplanationResult = {
  explanation: Record<string, unknown>;
  markdown: string;
  model: string;
};

/** The Kleidi Assist service, behind an interface so tests can stand in for it. */
export type Assist = {
  explainCyprus(input: {
    document: AssistDocument;
    question?: string | undefined;
  }): Promise<CyprusExplanationResult>;
};

/** File types the explainer reads. Word files would need converting first. */
export const EXPLAINABLE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
]);

/** An HTTP client for Kleidi Assist. The API key is sent as a bearer token when set. */
export function createAssistClient(config: {
  url: string;
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch;
}): Assist {
  const base = config.url.replace(/\/+$/, "");
  const doFetch = config.fetchImpl ?? fetch;
  return {
    async explainCyprus({ document, question }) {
      let res: Response;
      try {
        res = await doFetch(`${base}/api/v1/cyprus/explain`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            document: {
              name: document.name,
              mediaType: document.mediaType,
              data: document.bytes.toString("base64"),
            },
            ...(question ? { question } : {}),
          }),
          // A review reads the whole document, so it can take a couple of minutes.
          signal: AbortSignal.timeout(180_000),
        });
      } catch {
        throw new AppError("unavailable", "Kleidi Assist could not be reached", "assistFailed");
      }
      const body = (await res.json().catch(() => ({}))) as Partial<CyprusExplanationResult> & {
        error?: string;
      };
      if (!res.ok || !body.explanation) {
        throw new AppError(
          "unavailable",
          body.error ?? `Kleidi Assist answered ${res.status}`,
          "assistFailed",
        );
      }
      return {
        explanation: body.explanation,
        markdown: body.markdown ?? "",
        model: body.model ?? "",
      };
    },
  };
}
