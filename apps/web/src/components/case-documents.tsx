import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type CaseDocuments,
  type DocumentView,
  type ItemState,
  type Localised,
  type UploadTarget,
} from "../lib/api.ts";
import { newKey } from "../lib/cases.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Field, Icon } from "./ui.tsx";

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,.txt";

const STATE_CHIP: Record<ItemState, string> = {
  missing: "c-grey",
  scanning: "c-blue",
  ready: "c-green",
  infected: "c-red",
  failed: "c-red",
  expiring: "c-amber",
  expired: "c-red",
};

/** The case checklist: current stage open, outstanding items first, each with its files. */
export function CaseDocumentsCard({ caseId, closed }: { caseId: string; closed: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const pick = (l: Localised) => l[lang] ?? l.en ?? "";
  const docs = useQuery({
    queryKey: ["case", caseId, "documents"],
    queryFn: () => api.caseDocuments(caseId),
    // While a file is being scanned, look again every few seconds.
    refetchInterval: (q) => (hasScanning(q.state.data) ? 2500 : false),
  });
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!docs.data) return null;
  const { summary } = docs.data;

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("cases.docs.title")}</h2>
        <span className="muted">
          {t("cases.docs.summary", { ready: summary.ready, total: summary.total })}
          {summary.attention > 0 && (
            <span style={{ color: "var(--red)" }}>
              {" "}
              · {t("cases.docs.attention", { count: summary.attention })}
            </span>
          )}
        </span>
      </div>
      {docs.data.stages
        .filter((s) => s.items.length > 0)
        .map((s) => {
          const ready = s.items.filter((i) => i.state === "ready" || i.state === "expiring").length;
          const expanded = open[s.key] ?? s.position === "current";
          return (
            <div className="doc-stage" key={s.key}>
              <button
                type="button"
                className="doc-stage-head"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [s.key]: !expanded }))}
              >
                <span className={`caret ${expanded ? "open" : ""}`}>›</span>
                <b>{pick(s.label)}</b>
                {s.position === "current" && (
                  <span className="chip c-blue">{t("cases.docs.current")}</span>
                )}
                <span style={{ flex: 1 }} />
                <span className="muted">
                  {t("cases.docs.items", { ready, total: s.items.length })}
                </span>
              </button>
              {expanded &&
                s.items.map((item) => (
                  <DocumentRow
                    key={item.requirementKey}
                    caseId={caseId}
                    title={pick(item.label)}
                    help={pick(item.help)}
                    state={item.state}
                    document={item.document}
                    target={
                      item.document
                        ? { documentId: item.document.id }
                        : { requirementKey: item.requirementKey }
                    }
                    closed={closed}
                  />
                ))}
            </div>
          );
        })}
      <OtherDocuments caseId={caseId} docs={docs.data.other} closed={closed} />
    </section>
  );
}

const hasScanning = (d: CaseDocuments | undefined) =>
  Boolean(
    d &&
    [
      ...d.stages.flatMap((s) => s.items.map((i) => i.state)),
      ...d.other.map((o) => o.state),
    ].includes("scanning"),
  );

function useUpload(caseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, file }: { target: UploadTarget; file: File }) =>
      api.upload(caseId, target, file, newKey()),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["case", caseId, "documents"] }),
        queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }),
      ]),
  });
}

function DocumentRow({
  caseId,
  title,
  help,
  state,
  document,
  target,
  closed,
}: {
  caseId: string;
  title: string;
  help?: string;
  state: ItemState;
  document: DocumentView | null;
  target: UploadTarget;
  closed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);
  const upload = useUpload(caseId);
  const errorText = useErrorText();
  const visibility = useMutation({
    mutationFn: (v: "client" | "firm") => api.updateDocument(document!.id, { visibility: v }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["case", caseId, "documents"] }),
  });
  const latest = document?.versions[0];
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  async function download(versionId: string) {
    const { url } = await api.downloadLink(versionId);
    window.location.assign(url);
  }

  function pick(file: File | undefined) {
    if (!file) return;
    setTooBig(file.size > MAX_BYTES);
    if (file.size <= MAX_BYTES) upload.mutate({ target, file });
  }

  const busy = upload.isPending;
  const shownState: ItemState = busy ? "scanning" : state;

  return (
    <div className="doc-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ color: "var(--ink)" }}>{title}</b>
          <span className={`chip ${STATE_CHIP[shownState]}`}>
            {busy ? t("cases.docs.uploading") : t(`cases.docs.states.${shownState}`)}
          </span>
        </div>
        {!latest && help && <div className="muted">{help}</div>}
        {latest && (
          <div className="muted" style={{ overflowWrap: "anywhere" }}>
            {latest.fileName} ·{" "}
            {t("cases.docs.uploadedBy", {
              version: latest.version,
              name: latest.uploadedBy ?? "",
              date: date(latest.createdAt),
            })}
          </div>
        )}
        {document?.expiresOn && latest?.scanStatus === "clean" && (
          <div
            className="muted"
            style={{
              color:
                state === "expired"
                  ? "var(--red)"
                  : state === "expiring"
                    ? "var(--amber)"
                    : undefined,
            }}
          >
            {t(state === "expired" ? "cases.docs.expiredOn" : "cases.docs.expires", {
              date: date(document.expiresOn),
            })}
          </div>
        )}
        {latest?.scanStatus === "infected" && (
          <div className="muted" style={{ color: "var(--red)" }}>
            {t("cases.docs.quarantined", { signature: latest.scanDetail ?? "" })}
          </div>
        )}
        {document && document.versions.length > 1 && (
          <details className="history">
            <summary className="muted">
              {t("cases.docs.history", { count: document.versions.length - 1 })}
            </summary>
            {document.versions.slice(1).map((v) => (
              <div key={v.id} className="muted">
                {v.scanStatus === "clean" ? (
                  <button type="button" className="link" onClick={() => void download(v.id)}>
                    {v.fileName}
                  </button>
                ) : (
                  v.fileName
                )}{" "}
                ·{" "}
                {t("cases.docs.uploadedBy", {
                  version: v.version,
                  name: v.uploadedBy ?? "",
                  date: date(v.createdAt),
                })}
              </div>
            ))}
          </details>
        )}
        <ErrorAlert message={tooBig ? t("cases.docs.tooBig") : errorText(upload.error)} />
      </div>
      <div className="doc-actions">
        {document && latest && (
          <button
            type="button"
            className="btn quiet small"
            title={
              document.visibility === "firm" ? t("cases.docs.firmOnly") : t("cases.docs.shared")
            }
            onClick={() => visibility.mutate(document.visibility === "firm" ? "client" : "firm")}
            disabled={visibility.isPending || closed}
          >
            <Icon name={document.visibility === "firm" ? "lock" : "users"} />
            <span className="hide-sm">
              {document.visibility === "firm" ? t("cases.docs.firmOnly") : t("cases.docs.shared")}
            </span>
          </button>
        )}
        {latest?.scanStatus === "clean" && (
          <button type="button" className="btn small" onClick={() => void download(latest.id)}>
            <Icon name="download" />
            {t("cases.docs.download")}
          </button>
        )}
        {!closed && (
          <>
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`btn small ${latest ? "quiet" : "accent"}`}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" />
              {latest ? t("cases.docs.newVersion") : t("cases.docs.upload")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function OtherDocuments({
  caseId,
  docs,
  closed,
}: {
  caseId: string;
  docs: DocumentView[];
  closed: boolean;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const upload = useUpload(caseId);
  const errorText = useErrorText();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    upload.mutate(
      { target: { title: String(data.get("title") ?? "").trim() }, file },
      { onSuccess: () => setAdding(false) },
    );
  }

  return (
    <div className="doc-stage">
      <div className="doc-stage-head static">
        <b>{t("cases.docs.other")}</b>
        <span style={{ flex: 1 }} />
        {!closed && !adding && (
          <button type="button" className="btn quiet small" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t("cases.docs.addOther")}
          </button>
        )}
      </div>
      {docs.map((d) => (
        <DocumentRow
          key={d.id}
          caseId={caseId}
          title={d.title}
          state={d.state}
          document={d}
          target={{ documentId: d.id }}
          closed={closed}
        />
      ))}
      {docs.length === 0 && !adding && (
        <p className="muted" style={{ margin: 0, padding: "4px 18px 14px" }}>
          {t("cases.docs.noOther")}
        </p>
      )}
      {adding && (
        <form className="reason" onSubmit={submit}>
          <div className="grid-2">
            <Field label={t("cases.docs.docTitle")}>
              <input name="title" required minLength={2} maxLength={160} autoFocus />
            </Field>
            <Field label={t("cases.docs.upload")}>
              <input name="file" type="file" accept={ACCEPT} required />
            </Field>
          </div>
          <ErrorAlert message={errorText(upload.error)} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={upload.isPending}>
              {upload.isPending ? t("cases.docs.uploading") : t("cases.docs.upload")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
