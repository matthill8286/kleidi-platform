import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Message } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Icon } from "./ui.tsx";

/** A case thread with a box to reply. `mine` is the side the reader is on. */
export function Thread({
  messages,
  mine,
  onSend,
  sending,
  error,
}: {
  messages: Message[];
  mine: "firm" | "client";
  onSend: (body: string) => Promise<unknown>;
  sending: boolean;
  error: string | null;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.resolvedLanguage, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.trim()) return;
    await onSend(draft.trim());
    setDraft("");
  }

  return (
    <div style={{ display: "grid", gap: 10, padding: "0 18px 18px" }}>
      {messages.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("messages.empty")}
        </p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            justifySelf: m.author.kind === mine ? "end" : "start",
            maxWidth: "85%",
            background:
              m.author.kind === mine ? "var(--accent-soft, #FCEFE8)" : "var(--panel-2, #F4F2EE)",
            borderRadius: 12,
            padding: "8px 12px",
          }}
        >
          <div className="muted" style={{ fontSize: 12 }}>
            {m.author.name} · {when(m.createdAt)}
          </div>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</div>
        </div>
      ))}
      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder={t(
            mine === "firm" ? "messages.placeholderFirm" : "messages.placeholderClient",
          )}
          aria-label={t("messages.write")}
        />
        <ErrorAlert message={error} />
        <div>
          <button className="btn small accent" disabled={sending || !draft.trim()}>
            <Icon name="send" />
            {t("messages.send")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The firm's side of the case thread. */
export function MessagesCard({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const key = ["case", caseId, "messages"];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.messages(caseId),
    refetchInterval: 30_000,
  });
  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(caseId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("messages.title")}</h2>
      </div>
      <Thread
        messages={list.data ?? []}
        mine="firm"
        onSend={(body) => send.mutateAsync(body)}
        sending={send.isPending}
        error={errorText(send.error)}
      />
    </section>
  );
}
