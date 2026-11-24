import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type CyprusResult } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Icon } from "./ui.tsx";

// The file types Kleidi Assist reads.
const EXPLAINABLE = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
export const canExplainType = (mimeType: string) => EXPLAINABLE.has(mimeType);

/** Whether this firm can ask Kleidi Assist for explanations. */
export function useAssistEnabled() {
  const features = useQuery({ queryKey: ["features"], queryFn: api.features, staleTime: Infinity });
  return features.data?.assist ?? false;
}

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

/** Asks Kleidi Assist to explain one document version, with an optional question. */
export function ExplainButton({ caseId, versionId }: { caseId: string; versionId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const explain = useMutation({
    mutationFn: (question: string) => api.explain(versionId, question || undefined),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["case", caseId, "explanations"] });
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

/** One explanation, shown the same way to the lawyer and, once shared, to the client. */
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

/** The case's English explanations, newest first, each with its share switch. */
export function ExplanationsCard({ caseId }: { caseId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["case", caseId, "explanations"],
    queryFn: () => api.explanations(caseId),
  });
  const share = useMutation({
    mutationFn: ({ id, shared }: { id: string; shared: boolean }) =>
      api.shareExplanation(id, shared),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["case", caseId, "explanations"] }),
        queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }),
      ]),
  });
  if (!list.data?.length) return null;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <section className="card" id="explanations">
      <div className="card-head">
        <h2>{t("assist.title")}</h2>
      </div>
      {list.data.map((e) => (
        <div key={e.id} style={{ padding: "0 18px 18px", display: "grid", gap: 10 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
          >
            <div>
              <b>{e.documentTitle}</b>
              <div className="muted">
                {t("assist.by", {
                  file: e.fileName,
                  name: e.createdBy ?? "",
                  date: date(e.createdAt),
                })}
              </div>
              {e.question && (
                <div className="muted">{t("assist.asked", { question: e.question })}</div>
              )}
            </div>
            <button
              type="button"
              className="btn small"
              disabled={share.isPending}
              onClick={() => share.mutate({ id: e.id, shared: !e.sharedWithClient })}
            >
              <Icon name={e.sharedWithClient ? "check" : "send"} />
              {e.sharedWithClient ? t("assist.sharedWithClient") : t("assist.share")}
            </button>
          </div>
          <ExplanationView result={e.result} />
        </div>
      ))}
    </section>
  );
}
