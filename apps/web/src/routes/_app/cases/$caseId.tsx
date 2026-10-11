import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CaseDocumentsCard } from "../../../components/case-documents.tsx";
import { Avatar, ErrorAlert, Field, Icon } from "../../../components/ui.tsx";
import {
  api,
  ApiError,
  type Activity,
  type CaseDetail,
  type PartyInput,
  type PartyRole,
  type Transition,
} from "../../../lib/api.ts";
import { newKey, STATUS_CHIP, useStageLabels } from "../../../lib/cases.ts";

export const Route = createFileRoute("/_app/cases/$caseId")({ component: CasePage });

type ReasonKind = "stepBack" | "hold" | "cancel";
const ROLES: PartyRole[] = ["buyer", "seller", "developer", "bank"];

function CasePage() {
  const { t, i18n } = useTranslation();
  const { caseId } = Route.useParams();
  const { firm } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["case", caseId], queryFn: () => api.getCase(caseId) });
  // The audit trail is written by the worker a moment after each change, so keep it fresh.
  const activity = useQuery({
    queryKey: ["case", caseId, "activity"],
    queryFn: () => api.caseActivity(caseId),
    refetchInterval: 4000,
  });
  const [stale, setStale] = useState(false);

  const lang = i18n.resolvedLanguage ?? "en";
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });

  /** Every write answers with the fresh case; a 412 means someone else got there first. */
  function onWrite(promise: Promise<CaseDetail>) {
    setStale(false);
    return promise.then(
      async (fresh) => {
        queryClient.setQueryData(["case", caseId], fresh);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["cases", firm.id] }),
          queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }),
        ]);
        return fresh;
      },
      async (error: unknown) => {
        if (error instanceof ApiError && error.status === 412) {
          setStale(true);
          await queryClient.invalidateQueries({ queryKey: ["case", caseId], exact: true });
        }
        throw error;
      },
    );
  }

  if (detail.isPending) return <div className="page muted">{t("common.loading")}</div>;
  if (detail.isError)
    return (
      <div className="page">
        <ErrorAlert
          message={detail.error instanceof ApiError ? detail.error.message : t("common.error")}
        />
      </div>
    );

  const c = detail.data;
  const label = (key: string) => {
    const l = c.stages.find((s) => s.key === key)?.label;
    return l?.[lang] ?? l?.en ?? key;
  };
  const index = c.stages.findIndex((s) => s.key === c.currentStageKey);

  return (
    <div className="page">
      <Link to="/" className="back">
        <Icon name="arrowLeft" />
        {t("cases.detail.back")}
      </Link>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" translate="no">
            {c.reference}
          </div>
          <h1>{c.propertyAddress}</h1>
          <div className="meta">
            <span className={`chip ${STATUS_CHIP[c.status]}`}>
              {t(`cases.statuses.${c.status}`)}
            </span>
            <span>{t("cases.detail.progress", { n: index + 1, total: c.stages.length })}</span>
            {c.propertyType && <span>{t(`cases.types.${c.propertyType}`)}</span>}
            {c.plotOrRegNo && <span translate="no">{c.plotOrRegNo}</span>}
            {c.assignedLawyer && (
              <span>
                {t("cases.detail.lawyer")}: {c.assignedLawyer.name}
              </span>
            )}
            <span>{t("cases.detail.opened", { date: date(c.createdAt) })}</span>
          </div>
        </div>
      </div>

      {stale && <div className="alert warn">{t("cases.detail.stale")}</div>}
      {c.status === "on_hold" && c.statusReason && (
        <div className="alert warn">
          {t("cases.detail.heldBecause", { reason: c.statusReason })}
        </div>
      )}
      {c.status === "cancelled" && c.statusReason && (
        <div className="alert">
          {t("cases.detail.cancelledBecause", { reason: c.statusReason })}
        </div>
      )}

      <div className="case-grid">
        <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <Actions c={c} label={label} onWrite={onWrite} />
          <CaseDocumentsCard caseId={c.id} closed={c.status === "cancelled"} />
          <section className="card">
            <div className="card-head">
              <h2>{t("cases.detail.timeline")}</h2>
            </div>
            <ol className="timeline">
              {c.stages.map((s, i) => {
                const visits = c.history.filter((h) => h.stageKey === s.key);
                const last = visits.at(-1);
                const state =
                  c.status === "completed" || i < index ? "done" : i === index ? "current" : "todo";
                return (
                  <li key={s.key} className={state}>
                    <span className="dot">{state === "done" ? <Icon name="check" /> : i + 1}</span>
                    <div>
                      <b>{label(s.key)}</b>
                      {last && (
                        <div className="muted">
                          {state === "current"
                            ? t("cases.detail.entered", { date: date(last.enteredAt) })
                            : last.completedAt &&
                              t("cases.detail.done", { date: date(last.completedAt) })}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
        <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <Parties c={c} onWrite={onWrite} />
          <ActivityCard
            jurisdiction={c.jurisdictionCode}
            items={activity.data}
            label={label}
            date={date}
          />
        </div>
      </div>
    </div>
  );
}

function Actions({
  c,
  label,
  onWrite,
}: {
  c: CaseDetail;
  label: (key: string) => string;
  onWrite: (p: Promise<CaseDetail>) => Promise<CaseDetail>;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<ReasonKind | null>(null);
  const move = useMutation({
    mutationFn: (body: Transition) => onWrite(api.transition(c.id, c.version, body, newKey())),
    onSuccess: () => setAsking(null),
  });
  if (c.status === "completed" || c.status === "cancelled") return null;

  const index = c.stages.findIndex((s) => s.key === c.currentStageKey);
  const next = c.stages[index + 1];
  const isLast = index === c.stages.length - 2;
  const error =
    move.error && !(move.error instanceof ApiError && move.error.status === 412)
      ? move.error instanceof ApiError
        ? move.error.message
        : t("common.error")
      : null;

  function submitReason(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    if (asking) move.mutate({ kind: asking, reason });
  }

  return (
    <section className="card actions">
      <div className="action-row">
        {c.status === "open" && next && (
          <button
            className="btn accent"
            disabled={move.isPending}
            onClick={() => move.mutate({ kind: "advance" })}
          >
            {isLast ? <Icon name="check" /> : <Icon name="arrowRight" />}
            {isLast
              ? t("cases.detail.complete")
              : t("cases.detail.advance", { stage: label(next.key) })}
          </button>
        )}
        {c.status === "on_hold" && (
          <button
            className="btn accent"
            disabled={move.isPending}
            onClick={() => move.mutate({ kind: "resume" })}
          >
            <Icon name="play" />
            {t("cases.detail.resume")}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {c.status === "open" && index > 0 && (
          <button className="btn quiet" onClick={() => setAsking("stepBack")}>
            <Icon name="arrowLeft" />
            {t("cases.detail.stepBack")}
          </button>
        )}
        {c.status === "open" && (
          <button className="btn quiet" onClick={() => setAsking("hold")}>
            <Icon name="pause" />
            {t("cases.detail.hold")}
          </button>
        )}
        <button className="btn quiet danger" onClick={() => setAsking("cancel")}>
          <Icon name="x" />
          {t("cases.detail.cancel")}
        </button>
      </div>
      {asking && (
        <form className="reason" onSubmit={submitReason}>
          <Field label={t(`cases.detail.reasonFor.${asking}`)}>
            <input name="reason" required minLength={3} maxLength={500} autoFocus />
          </Field>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={() => setAsking(null)}>
              {t("common.cancel")}
            </button>
            <button
              className={`btn ${asking === "cancel" ? "danger-fill" : "primary"}`}
              disabled={move.isPending}
            >
              {t("cases.detail.confirm")}
            </button>
          </div>
        </form>
      )}
      <ErrorAlert message={error} />
    </section>
  );
}

function Parties({
  c,
  onWrite,
}: {
  c: CaseDetail;
  onWrite: (p: Promise<CaseDetail>) => Promise<CaseDetail>;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: (body: PartyInput) => onWrite(api.addParty(c.id, c.version, body, newKey())),
    onSuccess: () => setAdding(false),
  });
  const closed = c.status === "completed" || c.status === "cancelled";

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    add.mutate({
      role: data.get("role") as PartyRole,
      fullName: String(data.get("fullName") ?? "").trim(),
      ...(email ? { email } : {}),
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("cases.detail.parties")}</h2>
        {!closed && !adding && (
          <button className="btn quiet" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t("cases.detail.addParty")}
          </button>
        )}
      </div>
      {c.parties.map((p) => (
        <div className="list-row" key={p.id}>
          <Avatar name={p.fullName} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: "var(--ink)" }}>{p.fullName}</b>
            {(p.email || p.phone) && (
              <div className="muted clip">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          <span className="chip c-grey">{t(`cases.roles.${p.role}`)}</span>
        </div>
      ))}
      {adding && (
        <form className="reason" onSubmit={submit}>
          <div className="grid-2">
            <Field label={t("cases.form.partyRole")}>
              <select name="role" defaultValue="buyer">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`cases.roles.${r}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("cases.form.partyName")}>
              <input name="fullName" required minLength={2} maxLength={160} autoFocus />
            </Field>
          </div>
          <Field label={t("cases.form.partyEmail")} hint={t("cases.form.optional")}>
            <input name="email" type="email" />
          </Field>
          <ErrorAlert
            message={
              add.error && !(add.error instanceof ApiError && add.error.status === 412)
                ? add.error instanceof ApiError
                  ? add.error.message
                  : t("common.error")
                : null
            }
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={add.isPending}>
              {t("cases.detail.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ActivityCard({
  jurisdiction,
  items,
  label,
  date,
}: {
  jurisdiction: string;
  items: Activity | undefined;
  label: (key: string) => string;
  date: (iso: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const time = (iso: string) =>
    `${date(iso)}, ${new Date(iso).toLocaleTimeString(i18n.resolvedLanguage, { hour: "2-digit", minute: "2-digit" })}`;

  const { documentTitle } = useStageLabels(jurisdiction);

  function describe(a: Activity[number]) {
    const m = a.metadata as Record<string, string | null>;
    const title = documentTitle(m.requirementKey, m.title ?? "");
    switch (a.action) {
      case "cases.StageChanged":
        return t(m.direction === "back" ? "cases.events.stageBack" : "cases.events.stage", {
          to: label(m.to ?? ""),
        });
      case "cases.StatusChanged":
        return t("cases.events.status", { to: t(`cases.statuses.${m.to}`) });
      case "cases.PartyAdded":
        return t("cases.events.party", { name: m.fullName, role: t(`cases.roles.${m.role}`) });
      case "cases.CaseOpened":
        return t("cases.events.opened");
      case "documents.VersionUploaded":
        return t("cases.events.uploaded", { title, version: m.version });
      case "documents.VersionReleased":
        return t("cases.events.released", { title });
      case "documents.VersionQuarantined":
        return t("cases.events.quarantined", { title });
      case "documents.DocumentUpdated":
        return t("cases.events.updated", { title });
      case "documents.ExpiryFlagged":
        return t("cases.events.flagged", {
          title,
          state: t(`cases.docs.states.${m.state}`),
        });
      default:
        return a.action;
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("cases.detail.activity")}</h2>
      </div>
      {items && items.length > 0 ? (
        <ol className="activity">
          {[...items].reverse().map((a) => (
            <li key={a.id}>
              <span>
                {/* System events, such as virus scans, have no person behind them. */}
                {a.actorName && <b>{a.actorName} </b>}
                {describe(a)}
                {typeof a.metadata.reason === "string" && a.metadata.reason && (
                  <span className="muted"> · “{a.metadata.reason}”</span>
                )}
              </span>
              <span className="muted">{time(a.createdAt)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted" style={{ padding: "0 18px 16px", margin: 0 }}>
          {t("cases.detail.noActivity")}
        </p>
      )}
    </section>
  );
}
