import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type DocumentView, type LeaseFlag, type LeaseReview } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Field, Icon } from "./ui.tsx";
import { SimpleMarkdown } from "./markdown.tsx";

const SEVERITY_CHIP: Record<LeaseFlag["severity"], string> = {
  high: "c-red",
  medium: "c-amber",
  info: "",
};

/** Clean files on the case that could be the lease, newest version of each. */
function leaseCandidates(docs: {
  stages: { items: { document: DocumentView | null }[] }[];
  other: DocumentView[];
}) {
  const all = [...docs.stages.flatMap((s) => s.items.map((i) => i.document)), ...docs.other].filter(
    (d): d is DocumentView => d !== null,
  );
  return all.filter((d) => {
    const v = d.versions[0];
    return v && v.scanStatus === "clean" && /pdf|jpeg|png/.test(v.mimeType);
  });
}

/**
 * Kleidi Assist reads the lease and drafts a report and a summary for the buyer. The lawyer
 * edits both; approving the summary translates it and shows it in the buyer's portal.
 */
export function LeaseReviewCard({ caseId, closed }: { caseId: string; closed: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const key = ["case", caseId, "lease-review"];
  const state = useQuery({ queryKey: key, queryFn: () => api.leaseReview(caseId) });
  const docs = useQuery({
    queryKey: ["case", caseId, "documents"],
    queryFn: () => api.caseDocuments(caseId),
  });
  const [starting, setStarting] = useState(false);
  const review = state.data?.review ?? null;
  // The lawyer's unsaved edits, kept against the review they belong to.
  const [edits, setEdits] = useState<{ id: string; report: string; summary: string } | null>(null);
  const current = review && edits?.id === review.id ? edits : null;
  const report = current?.report ?? review?.report ?? "";
  const summary = current?.summary ?? review?.buyerSummary ?? "";
  const setReport = (v: string) => review && setEdits({ id: review.id, report: v, summary });
  const setSummary = (v: string) => review && setEdits({ id: review.id, report, summary: v });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }),
    ]);
  const start = useMutation({
    mutationFn: (body: Parameters<typeof api.reviewLease>[1]) => api.reviewLease(caseId, body),
    onSuccess: async () => {
      setStarting(false);
      await refresh();
    },
  });
  const save = useMutation({
    mutationFn: (r: LeaseReview) => api.updateLeaseReview(r.id, { report, buyerSummary: summary }),
    onSuccess: async () => {
      await refresh();
      setEdits(null);
    },
  });
  const approve = useMutation({
    mutationFn: async (r: LeaseReview) => {
      if (report !== r.report || summary !== r.buyerSummary) {
        await api.updateLeaseReview(r.id, { report, buyerSummary: summary });
      }
      return api.approveLeaseReview(r.id);
    },
    onSuccess: async () => {
      await refresh();
      setEdits(null);
    },
  });

  if (!state.data?.available) return null;
  const candidates = docs.data ? leaseCandidates(docs.data) : [];

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = Number(String(data.get("value") ?? "").replace(/[^\d.]/g, ""));
    start.mutate({
      documentId: String(data.get("documentId")),
      plansToLet: data.get("plansToLet") === "on",
      inLondon: data.get("inLondon") === "on",
      ...(value > 0 ? { propertyValue: value } : {}),
    });
  }

  const computed = review?.result.computed;
  const flags = review?.result.flags ?? [];
  const quotes = review?.result.quotes ?? [];
  const missing = quotes.filter((q) => q.check === "not_found").length;
  const dirty = review ? report !== review.report || summary !== review.buyerSummary : false;

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("lease.title")}</h2>
        {!closed && !starting && (
          <button
            className="btn quiet"
            onClick={() => setStarting(true)}
            disabled={start.isPending}
          >
            <Icon name="plus" />
            {review ? t("lease.again") : t("lease.start")}
          </button>
        )}
      </div>

      {starting && (
        <form className="reason" onSubmit={submit} style={{ margin: "0 18px 14px" }}>
          {candidates.length === 0 ? (
            <p className="muted">{t("lease.noFiles")}</p>
          ) : (
            <>
              <Field label={t("lease.document")}>
                <select name="documentId" required defaultValue={candidates[0]?.id}>
                  {candidates.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("lease.value")} hint={t("lease.valueHint")}>
                <input name="value" inputMode="numeric" placeholder="250000" />
              </Field>
              <label>
                <input type="checkbox" name="plansToLet" /> {t("lease.plansToLet")}
              </label>
              <label>
                <input type="checkbox" name="inLondon" /> {t("lease.inLondon")}
              </label>
            </>
          )}
          <ErrorAlert message={errorText(start.error)} />
          <div className="actions">
            <button className="btn quiet" type="button" onClick={() => setStarting(false)}>
              {t("common.cancel")}
            </button>
            {candidates.length > 0 && (
              <button className="btn primary" disabled={start.isPending}>
                {start.isPending ? t("lease.reading") : t("lease.review")}
              </button>
            )}
          </div>
        </form>
      )}

      {!review && !starting && (
        <p className="muted" style={{ margin: "0 18px 18px" }}>
          {t("lease.empty")}
        </p>
      )}

      {review && (
        <div style={{ padding: "0 18px 18px", display: "grid", gap: 12 }}>
          <div className="muted">
            {t("lease.from", { title: review.documentTitle })}
            {" · "}
            {review.status === "approved" ? (
              <span className="chip c-green">{t("lease.approved")}</span>
            ) : (
              <span className="chip c-amber">{t("lease.draft")}</span>
            )}
          </div>
          {computed && computed.yearsRemaining !== null && (
            <div>
              <b>{t("lease.yearsLeft", { years: computed.yearsRemaining })}</b>
              {computed.peakRent ? (
                <span className="muted">
                  {" "}
                  · {t("lease.peakRent", { amount: computed.peakRent.toLocaleString("en-GB") })}
                </span>
              ) : null}
            </div>
          )}
          {missing > 0 && (
            <div className="alert warn">{t("lease.quotesMissing", { count: missing })}</div>
          )}
          {flags.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {flags.map((f, i) => (
                <div key={i} className="doc-row" style={{ alignItems: "start" }}>
                  <div className="doc-main">
                    <div
                      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                    >
                      <span className={`chip ${SEVERITY_CHIP[f.severity]}`}>
                        {t(`lease.severity.${f.severity}`)}
                      </span>
                      <b>{f.title}</b>
                    </div>
                    <div className="muted">
                      {f.detail}
                      {f.page ? ` (${f.clause ? `${f.clause}, ` : ""}p. ${f.page})` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Field label={t("lease.report")} hint={t("lease.reportHint")}>
            <textarea
              rows={10}
              value={report}
              onChange={(e) => setReport(e.target.value)}
              readOnly={review.status === "approved"}
            />
          </Field>
          <Field
            label={t("lease.summary")}
            hint={review.status === "approved" ? t("lease.summaryShared") : t("lease.summaryHint")}
          >
            <textarea
              rows={8}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              readOnly={review.status === "approved"}
            />
          </Field>
          <div className="card" style={{ padding: 12, background: "var(--bg)" }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              {t("lease.preview")}
            </div>
            <SimpleMarkdown text={summary} />
          </div>
          <ErrorAlert message={errorText(save.error ?? approve.error)} />
          {review.status === "draft" && !closed && (
            <div className="actions">
              <button
                className="btn quiet"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(review)}
              >
                {t("lease.save")}
              </button>
              <button
                className="btn primary"
                disabled={approve.isPending}
                onClick={() => approve.mutate(review)}
              >
                {approve.isPending ? t("lease.approving") : t("lease.approve")}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
