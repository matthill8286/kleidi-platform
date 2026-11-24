import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CyprusResult } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { portal } from "../lib/portal.ts";
import { ErrorAlert, Icon } from "./ui.tsx";

// The file types Kleidi Assist reads.
const EXPLAINABLE = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
export const canExplainType = (mimeType: string) => EXPLAINABLE.has(mimeType);

const STATUS_CHIP: Record<string, string> = {
  issued: "c-green",
  pending: "c-amber",
  trapped: "c-red",
  unclear: "c-grey",
};
const SUB = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  margin: "0 0 6px",
} as const;
const SEVERITY_CHIP: Record<string, string> = { high: "c-red", medium: "c-amber", low: "c-grey" };

/** In the client portal: asks Kleidi Assist to explain one shared document, with an optional question. */
export function PortalExplainButton({
  versionId,
  onDone,
}: {
  versionId: string;
  onDone: () => unknown;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const explain = useMutation({
    mutationFn: (question: string) => portal.explain(versionId, question || undefined),
    onSuccess: async () => {
      setOpen(false);
      await onDone();
      document.getElementById("explanations")?.scrollIntoView({ behavior: "smooth" });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    explain.mutate(String(new FormData(e.currentTarget).get("question") ?? "").trim());
  }

  if (!open) {
    return (
      <button type="button" className="btn small quiet" onClick={() => setOpen(true)}>
        <Icon name="search" />
        {t("assist.explain")}
      </button>
    );
  }
  return (
    <form className="reason" onSubmit={submit} style={{ flexBasis: "100%" }}>
      <input name="question" maxLength={1000} placeholder={t("assist.questionHint")} />
      <ErrorAlert message={errorText(explain.error)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small accent" disabled={explain.isPending}>
          {explain.isPending ? t("assist.running") : t("assist.run")}
        </button>
        <button type="button" className="btn small quiet" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
        {explain.isPending && <span className="muted">{t("assist.wait")}</span>}
      </div>
    </form>
  );
}

/** One explanation, as the client sees it in the portal. */
export function ExplanationView({ result }: { result: CyprusResult }) {
  const { t } = useTranslation();
  const p = result.property ?? {};
  const where = [p.description, p.municipality, p.district].filter(Boolean).join(", ");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="meta">
        {result.title_status && (
          <span className={`chip ${STATUS_CHIP[result.title_status] ?? "c-grey"}`}>
            {t("assist.titleStatus")}: {t(`assist.statuses.${result.title_status}`)}
          </span>
        )}
        {where && <span>{where}</span>}
        {result.registered_owner && (
          <span>
            {t("assist.owner")}: {result.registered_owner}
          </span>
        )}
      </div>
      {result.plain_english_summary && <p style={{ margin: 0 }}>{result.plain_english_summary}</p>}
      {(result.encumbrances?.length ?? 0) > 0 && (
        <div>
          <h3 style={SUB}>{t("assist.charges")}</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.encumbrances!.map((c, i) => (
              <li key={i}>
                <b>{[c.reference, c.in_favour_of, c.amount].filter(Boolean).join(" · ")}</b>{" "}
                {c.meaning}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(result.risks?.length ?? 0) > 0 && (
        <div>
          <h3 style={SUB}>{t("assist.risks")}</h3>
          {result.risks!.map((r, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <span className={`chip ${SEVERITY_CHIP[r.severity] ?? "c-grey"}`}>
                {t(`assist.severity.${r.severity}`)}
              </span>{" "}
              <b>{r.issue}</b>
              <blockquote
                className="muted"
                style={{
                  margin: "4px 0 0",
                  paddingLeft: 10,
                  borderLeft: "3px solid var(--line, #ddd)",
                }}
              >
                <i lang="el">{r.original_text}</i>
                <br />
                {r.english}
              </blockquote>
            </div>
          ))}
        </div>
      )}
      {(result.questions_for_cypriot_lawyer?.length ?? 0) > 0 && (
        <div>
          <h3 style={SUB}>{t("assist.questions")}</h3>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {result.questions_for_cypriot_lawyer!.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      )}
      {result.caveat && <small className="muted">{result.caveat}</small>}
    </div>
  );
}
