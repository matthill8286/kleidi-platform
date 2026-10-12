import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CaseDocumentsCard } from "../../../components/case-documents.tsx";
import { PartyRow } from "../../../components/client-access.tsx";
import { CaseDeadlinesCard } from "../../../components/deadlines.tsx";
import { ErrorAlert, Field, Icon } from "../../../components/ui.tsx";
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
import { useErrorText } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_app/cases/$caseId")({ component: CasePage });

type ReasonKind = "advance" | "stepBack" | "hold" | "cancel" | "reopen";
const ROLES: PartyRole[] = ["buyer", "seller", "developer", "bank"];

function CasePage() {
  const { t, i18n } = useTranslation();
  const { caseId } = Route.useParams();
  const { firm } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const detail = useQuery({ queryKey: ["case", caseId], queryFn: () => api.getCase(caseId) });
  // Shared with the documents card, so the checklist and the stage gate stay in step.
  const docs = useQuery({
    queryKey: ["case", caseId, "documents"],
    queryFn: () => api.caseDocuments(caseId),
  });
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
          // The stage decides which checklist items are current, so reload them too.
          queryClient.invalidateQueries({ queryKey: ["case", caseId, "documents"] }),
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
        <ErrorAlert message={errorText(detail.error)} />
      </div>
    );

  const c = detail.data;
  const label = (key: string) => {
    const l = c.stages.find((s) => s.key === key)?.label;
    return l?.[lang] ?? l?.en ?? key;
  };
  const index = c.stages.findIndex((s) => s.key === c.currentStageKey);
  const pick = (l: Record<string, string>) => l[lang] ?? l.en ?? "";
  const docStages = docs.data?.stages ?? [];
  const gapsBehind = docs.data?.summary.gapsBehind ?? 0;
  const gapAt = new Map(
    docStages.filter((s) => s.position === "past").map((s) => [s.key, s.outstanding]),
  );
  const currentDocs = docStages.find((s) => s.position === "current");
  const outstanding = (currentDocs?.items ?? [])
    .filter((i) => i.state !== "ready" && i.state !== "expiring")
    .map((i) => pick(i.label));

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
      {gapsBehind > 0 && c.status !== "cancelled" && (
        <div className="alert warn">{t("cases.detail.gapsBehind", { count: gapsBehind })}</div>
      )}
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
          <Actions
            c={c}
            label={label}
            onWrite={onWrite}
            outstanding={outstanding}
            stageComplete={Boolean(currentDocs?.items.length) && outstanding.length === 0}
            isAdmin={firm.role === "firm_admin"}
          />
          <CaseDocumentsCard
            caseId={c.id}
            closed={c.status === "completed" || c.status === "cancelled"}
          />
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
                const gap = state === "done" && (gapAt.get(s.key) ?? 0) > 0;
                return (
                  <li key={s.key} className={`${state} ${gap ? "gap" : ""}`}>
                    <span
                      className="dot"
                      title={
                        gap ? t("cases.docs.missingCount", { count: gapAt.get(s.key) }) : undefined
                      }
                    >
                      {gap ? "!" : state === "done" ? <Icon name="check" /> : i + 1}
                    </span>
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
          <CaseDeadlinesCard
            caseId={c.id}
            closed={c.status === "completed" || c.status === "cancelled"}
          />
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
  outstanding,
  stageComplete,
  isAdmin,
}: {
  c: CaseDetail;
  label: (key: string) => string;
  onWrite: (p: Promise<CaseDetail>) => Promise<CaseDetail>;
  outstanding: string[];
  stageComplete: boolean;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<ReasonKind | null>(null);
  const errorText = useErrorText();
  const move = useMutation({
    mutationFn: (body: Transition) => onWrite(api.transition(c.id, c.version, body, newKey())),
    onSuccess: () => setAsking(null),
  });
  const closed = c.status === "completed" || c.status === "cancelled";
  const index = c.stages.findIndex((s) => s.key === c.currentStageKey);
  const next = c.stages[index + 1];
  const isLast = index === c.stages.length - 2;
  const error =
    move.error instanceof ApiError && move.error.status === 412 ? null : errorText(move.error);

  function submitReason(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
    if (asking === "advance") move.mutate({ kind: "advance", override: reason });
    else if (asking) move.mutate({ kind: asking, reason });
  }

  // A closed case is read-only; a firm admin can reopen it with a reason.
  if (closed) {
    return (
      <section className="card actions">
        <div className="action-row">
          <span className="muted" style={{ flex: 1 }}>
            {t("cases.detail.readOnly", { status: t(`cases.statuses.${c.status}`) })}
          </span>
          {isAdmin && !asking && (
            <button className="btn" onClick={() => setAsking("reopen")}>
              <Icon name="arrowLeft" />
              {t("cases.detail.reopen")}
            </button>
          )}
        </div>
        {asking === "reopen" && (
          <form className="reason" onSubmit={submitReason}>
            <Field label={t("cases.detail.reasonFor.reopen")}>
              <input name="reason" required minLength={3} maxLength={500} autoFocus />
            </Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn quiet" onClick={() => setAsking(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn primary" disabled={move.isPending}>
                {t("cases.detail.reopen")}
              </button>
            </div>
          </form>
        )}
        <ErrorAlert message={error} />
      </section>
    );
  }

  return (
    <section className="card actions">
      {/* Every checklist item for this stage is accepted: the next step is one click. */}
      {stageComplete && c.status === "open" && next && (
        <div className="alert ok" style={{ margin: 0 }}>
          {t("cases.detail.stageDone", {
            stage: label(c.currentStageKey),
            next: label(next.key),
          })}
        </div>
      )}
      <div className="action-row">
        {c.status === "open" && next && (
          <button
            className="btn accent"
            disabled={move.isPending}
            // An unfinished checklist needs a reason before the case moves on.
            onClick={() =>
              outstanding.length > 0 ? setAsking("advance") : move.mutate({ kind: "advance" })
            }
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
          {asking === "advance" && (
            <div className="alert warn" style={{ margin: 0 }}>
              <b>{t("cases.detail.notDone", { count: outstanding.length })}</b>
              <ul className="plain-list">
                {outstanding.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
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
              {asking === "advance" ? t("cases.detail.moveAnyway") : t("cases.detail.confirm")}
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
  const errorText = useErrorText();
  const add = useMutation({
    mutationFn: (body: PartyInput) => onWrite(api.addParty(c.id, c.version, body, newKey())),
    onSuccess: () => setAdding(false),
  });
  const closed = c.status === "completed" || c.status === "cancelled";
  const queryClient = useQueryClient();
  const portalAccess = useQuery({
    queryKey: ["case", c.id, "portal"],
    queryFn: () => api.portalAccess(c.id),
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    add.mutate({
      role: data.get("role") as PartyRole,
      fullName: String(data.get("fullName") ?? "").trim(),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
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
        <PartyRow
          key={p.id}
          caseId={c.id}
          party={p}
          access={portalAccess.data?.find((a) => a.partyId === p.id)}
          closed={closed}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ["case", c.id], exact: true })}
        />
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
          <div className="grid-2">
            <Field label={t("cases.form.partyEmail")} hint={t("cases.form.optional")}>
              <input name="email" type="email" />
            </Field>
            <Field label={t("settings.phone")} hint={t("cases.form.optional")}>
              <input name="phone" type="tel" placeholder="+357 99 123456" />
            </Field>
          </div>
          <ErrorAlert
            message={
              add.error instanceof ApiError && add.error.status === 412
                ? null
                : errorText(add.error)
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
      case "cases.StageChanged": {
        const skipped = Array.isArray(a.metadata.skipped) ? a.metadata.skipped.length : 0;
        if (m.direction === "back") return t("cases.events.stageBack", { to: label(m.to ?? "") });
        return skipped
          ? t("cases.events.stageSkipped", { to: label(m.to ?? ""), count: skipped })
          : t("cases.events.stage", { to: label(m.to ?? "") });
      }
      case "cases.StatusChanged":
        return t("cases.events.status", { to: t(`cases.statuses.${m.to}`) });
      case "cases.PartyAdded":
        return t("cases.events.party", { name: m.fullName, role: t(`cases.roles.${m.role}`) });
      case "cases.CaseOpened":
        return t("cases.events.opened");
      case "deadlines.DeadlineAdded":
        return t("cases.events.deadlineAdded", { title: m.title });
      case "deadlines.DeadlineChanged":
        return t("cases.events.deadlineChanged", { title: m.title });
      case "deadlines.DeadlineCompleted":
        return t("cases.events.deadlineCompleted", { title: m.title });
      case "deadlines.DeadlineReopened":
        return t("cases.events.deadlineReopened", { title: m.title });
      case "deadlines.DeadlineRemoved":
        return t("cases.events.deadlineRemoved", { title: m.title });
      case "deadlines.ReminderDue":
        return t("cases.events.reminderSent", { title: m.title });
      case "documents.VersionUploaded":
        return m.client
          ? t("portal.events.clientSent", { name: m.client, title })
          : t("cases.events.uploaded", { title, version: m.version });
      case "portal.ClientInvited":
        return t("portal.events.invited", { name: m.partyName });
      case "portal.ClientSignedIn":
        return t("portal.events.signedIn");
      case "portal.AccessRevoked":
        return t("portal.events.revoked");
      case "portal.PrivacyAccepted":
        return t("portal.events.privacy", { version: m.version });
      case "consent.Granted":
        return t("portal.events.consentGranted", {
          who: t(`portal.sharing.types.${m.granteeType}`),
          ref: m.granteeRef,
        });
      case "consent.Revoked":
        return t("portal.events.consentRevoked", {
          who: t(`portal.sharing.types.${m.granteeType}`),
          ref: m.granteeRef,
        });
      case "cases.PartyContactChanged":
        return t("portal.events.contact", { name: m.fullName });
      case "documents.ClientRequestChanged":
        return t(a.metadata.requested ? "portal.events.requested" : "portal.events.unrequested", {
          title,
        });
      case "documents.VersionAccepted":
        return t("cases.events.accepted", { title, version: m.version });
      case "documents.VersionRejected":
        return t("cases.events.rejected", { title, version: m.version });
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
