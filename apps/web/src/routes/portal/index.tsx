import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorAlert, Field, Icon } from "../../components/ui.tsx";
import { ApiError } from "../../lib/api.ts";
import { useStageLabels } from "../../lib/cases.ts";
import { useErrorText } from "../../lib/errors.ts";
import { portal, type PortalCase, type PortalDocument } from "../../lib/portal.ts";

export const Route = createFileRoute("/portal/")({ component: PortalHome });

const ME = ["portal", "me"];
const CASE = ["portal", "case"];

function PortalHome() {
  const { i18n } = useTranslation();
  const me = useQuery({ queryKey: ME, queryFn: portal.me, retry: false });
  const locale = me.data?.locale;
  useEffect(() => {
    if (locale && locale !== i18n.resolvedLanguage) void i18n.changeLanguage(locale);
  }, [locale, i18n]);

  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to="/portal/sign-in" />;
  if (!me.data) return null;
  return me.data.privacyAccepted ? <CaseView /> : <Privacy />;
}

/** The client accepts the privacy notice before seeing anything; the firm keeps the record. */
function Privacy() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const accept = useMutation({
    mutationFn: portal.acceptPrivacy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME }),
  });
  return (
    <section className="card portal-card">
      <h1>{t("portal.privacy.title")}</h1>
      <p>{t("portal.privacy.p1")}</p>
      <p>{t("portal.privacy.p2")}</p>
      <p className="muted">{t("portal.privacy.p3")}</p>
      <ErrorAlert message={errorText(accept.error)} />
      <button
        className="btn primary block"
        disabled={accept.isPending}
        onClick={() => accept.mutate()}
      >
        <Icon name="check" />
        {t("portal.privacy.accept")}
      </button>
    </section>
  );
}

function CaseView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: CASE,
    queryFn: portal.case,
    // While a sent file is being checked, look again every few seconds.
    refetchInterval: (q) =>
      q.state.data?.documents.some((d) => d.latest?.fromYou && d.latest.scanStatus === "pending")
        ? 3000
        : false,
  });
  const signOut = useMutation({
    mutationFn: portal.signOut,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["portal"] });
      await navigate({ to: "/portal/sign-in" });
    },
  });
  if (!data.data) return null;
  const { case: c, documents } = data.data;
  const lang = i18n.resolvedLanguage ?? "en";
  const current = c.stages.find((s) => s.position === "current");
  const requested = documents.filter((d) => d.requested);
  const others = documents.filter((d) => !d.requested);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="card portal-card">
        <div className="eyebrow" translate="no">
          {data.data.firmName} · {c.reference}
        </div>
        <h1>{c.propertyAddress}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {c.status === "completed"
            ? t("portal.case.completed")
            : t("portal.case.now", {
                stage: current ? (current.label[lang] ?? current.label.en) : "",
              })}
        </p>
        <ol className="steps">
          {c.stages.map((s, i) => (
            <li key={s.key} className={s.position}>
              <span className="dot">{s.position === "done" ? <Icon name="check" /> : i + 1}</span>
              <span>{s.label[lang] ?? s.label.en}</span>
            </li>
          ))}
        </ol>
      </section>

      {requested.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>{t("portal.docs.requests")}</h2>
          </div>
          {requested.map((d) => (
            <ClientDocument key={d.id} d={d} />
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{t("portal.docs.title")}</h2>
        </div>
        {others.map((d) => (
          <ClientDocument key={d.id} d={d} />
        ))}
        {others.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: "0 18px 12px" }}>
            {t("portal.docs.none")}
          </p>
        )}
        <SendOther />
      </section>

      <div className="portal-grid">
        {data.data.lawyer && (
          <section className="card portal-card">
            <h2>{t("portal.lawyer.title")}</h2>
            <p style={{ margin: 0 }}>
              <b>{data.data.lawyer.name}</b>
              <br />
              <a href={`mailto:${data.data.lawyer.email}`}>{data.data.lawyer.email}</a>
            </p>
          </section>
        )}
        <Sharing consents={data.data.consents} />
      </div>

      <div style={{ textAlign: "center" }}>
        <button className="btn quiet" onClick={() => signOut.mutate()}>
          <Icon name="logout" />
          {t("nav.signOut")}
        </button>
      </div>
    </div>
  );
}

function useRefreshCase() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CASE });
}

/** One document as the client sees it: what is needed, what happened to their file, or a download. */
function ClientDocument({ d }: { d: PortalDocument }) {
  const { t, i18n } = useTranslation();
  const { documentTitle } = useStageLabels();
  const errorText = useErrorText();
  const refresh = useRefreshCase();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => portal.upload({ documentId: d.id }, file),
    onSettled: refresh,
  });
  const l = d.latest;
  const mine = l?.fromYou;
  const needsFile =
    d.requested &&
    (!mine ||
      l?.review === "rejected" ||
      l?.scanStatus === "infected" ||
      l?.scanStatus === "failed");
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, { day: "numeric", month: "short" });

  let status: { text: string; tone: string } | null = null;
  if (mine && l) {
    if (l.scanStatus === "pending") status = { text: t("portal.docs.checking"), tone: "c-blue" };
    else if (l.scanStatus === "infected" || l.scanStatus === "failed")
      status = { text: t("portal.docs.unusable"), tone: "c-red" };
    else if (l.review === "accepted") status = { text: t("portal.docs.accepted"), tone: "c-green" };
    else if (l.review === "rejected") status = { text: t("portal.docs.newNeeded"), tone: "c-red" };
    else status = { text: t("portal.docs.withLawyer"), tone: "c-amber" };
  } else if (d.requested) {
    status = { text: t("portal.docs.needed"), tone: "c-amber" };
  }

  return (
    <div className="doc-row portal-doc">
      <div className="doc-main">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ color: "var(--ink)" }}>{documentTitle(d.requirementKey, d.title)}</b>
          {status && <span className={`chip ${status.tone}`}>{status.text}</span>}
        </div>
        {l && (
          <div className="muted" style={{ overflowWrap: "anywhere" }}>
            {l.fileName} ·{" "}
            {mine ? t("portal.docs.sentOn", { date: date(l.createdAt) }) : date(l.createdAt)}
          </div>
        )}
        {mine && l?.review === "rejected" && l.reviewNote && (
          <div style={{ color: "var(--red)", fontSize: 13 }}>{l.reviewNote}</div>
        )}
        <ErrorAlert message={errorText(upload.error)} />
      </div>
      <div className="doc-actions">
        {l?.downloadable && !mine && (
          <button
            className="btn small"
            onClick={async () => window.location.assign((await portal.download(l.id)).url)}
          >
            <Icon name="download" />
            {t("cases.docs.download")}
          </button>
        )}
        {needsFile && (
          <>
            <input
              ref={input}
              type="file"
              hidden
              accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              className="btn small accent"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" />
              {upload.isPending ? t("cases.docs.uploading") : t("cases.docs.upload")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Anything else the client wants their lawyer to have. */
function SendOther() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useRefreshCase();
  const [open, setOpen] = useState(false);
  const upload = useMutation({
    mutationFn: ({ title, file }: { title: string; file: File }) => portal.upload({ title }, file),
    onSuccess: () => setOpen(false),
    onSettled: refresh,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      upload.mutate({ title: String(data.get("title") ?? "").trim(), file });
    }
  }

  if (!open) {
    return (
      <div style={{ padding: "12px 18px 16px" }}>
        <button className="btn" onClick={() => setOpen(true)}>
          <Icon name="plus" />
          {t("portal.docs.sendOther")}
        </button>
      </div>
    );
  }
  return (
    <form className="reason" onSubmit={submit}>
      <div className="grid-2">
        <Field label={t("cases.docs.docTitle")}>
          <input name="title" required minLength={2} maxLength={160} autoFocus />
        </Field>
        <Field label={t("cases.docs.upload")}>
          <input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" />
        </Field>
      </div>
      <ErrorAlert message={errorText(upload.error)} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn quiet" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </button>
        <button className="btn primary" disabled={upload.isPending}>
          {upload.isPending ? t("cases.docs.uploading") : t("portal.docs.send")}
        </button>
      </div>
    </form>
  );
}

/** Who else the client lets follow the case: their agent, bank or insurer. */
function Sharing({ consents }: { consents: PortalCase["consents"] }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useRefreshCase();
  const grant = useMutation({
    mutationFn: ({ type, email }: { type: string; email: string }) => portal.grant(type, email),
    onSettled: refresh,
  });
  const revoke = useMutation({ mutationFn: portal.revoke, onSettled: refresh });
  const active = consents.filter((c) => !c.revokedAt);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    grant.mutate(
      { type: String(data.get("type")), email: String(data.get("email") ?? "").trim() },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <section className="card portal-card">
      <h2>{t("portal.sharing.title")}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {t("portal.sharing.lead")}
      </p>
      {active.map((c) => (
        <div key={c.id} className="consent-row">
          <span>
            <b>{t(`portal.sharing.types.${c.granteeType}`)}</b> · {c.granteeRef}
          </span>
          <button
            className="btn quiet small"
            onClick={() => revoke.mutate(c.id)}
            disabled={revoke.isPending}
          >
            {t("portal.sharing.stop")}
          </button>
        </div>
      ))}
      <form onSubmit={submit} className="consent-form">
        <select name="type" aria-label={t("portal.sharing.who")} defaultValue="agent">
          {(["agent", "bank", "insurer"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`portal.sharing.types.${k}`)}
            </option>
          ))}
        </select>
        <input
          name="email"
          type="email"
          required
          placeholder={t("auth.email")}
          aria-label={t("auth.email")}
        />
        <button className="btn small" disabled={grant.isPending}>
          {t("portal.sharing.allow")}
        </button>
      </form>
      <ErrorAlert message={errorText(grant.error ?? revoke.error)} />
    </section>
  );
}
