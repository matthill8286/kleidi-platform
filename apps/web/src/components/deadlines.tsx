import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Deadline, type Urgency } from "../lib/api.ts";
import { newKey } from "../lib/cases.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Field, Icon } from "./ui.tsx";

export const REMINDER_CHOICES = [168, 72, 24, 2] as const;

const URGENCY_CHIP: Record<Urgency, string> = {
  overdue: "c-red",
  today: "c-amber",
  week: "c-blue",
  later: "c-grey",
  done: "c-green",
};

/** Refreshes every view that shows deadlines or the case activity. */
function useRefresh(caseId?: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["deadlines"] }),
      caseId ? queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }) : null,
    ]);
}

export function useWhen() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    new Date(iso).toLocaleString(i18n.resolvedLanguage, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
}

export function DeadlineRow({
  d,
  showCase,
  closed,
}: {
  d: Deadline;
  showCase?: boolean;
  closed?: boolean;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const errorText = useErrorText();
  const refresh = useRefresh(d.caseId);
  const toggle = useMutation({
    mutationFn: (done: boolean) => api.updateDeadline(d.id, { done }),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => api.removeDeadline(d.id), onSettled: refresh });
  const done = Boolean(d.completedAt);

  return (
    <div className={`deadline-row ${done ? "done" : ""}`}>
      <input
        type="checkbox"
        className="tick"
        checked={done}
        disabled={toggle.isPending || closed}
        aria-label={done ? t("deadlines.reopen") : t("deadlines.markDone")}
        onChange={(e) => toggle.mutate(e.target.checked)}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ color: "var(--ink)" }}>{d.title}</b>
          <span className={`chip ${URGENCY_CHIP[d.urgency]}`}>
            {t(`deadlines.urgency.${d.urgency}`)}
          </span>
        </div>
        <div className="muted">
          {when(d.dueAt)}
          {d.owner && ` · ${d.owner.name}`}
          {showCase && (
            <>
              {" · "}
              <Link
                to="/cases/$caseId"
                params={{ caseId: d.caseId }}
                className="ref"
                translate="no"
              >
                {d.caseReference}
              </Link>
              {d.propertyAddress && ` · ${d.propertyAddress}`}
            </>
          )}
        </div>
        {d.notes && <div className="muted">{d.notes}</div>}
        <ErrorAlert message={errorText(toggle.error ?? remove.error)} />
      </div>
      {!closed && (
        <button
          type="button"
          className="btn quiet small danger"
          aria-label={t("deadlines.remove")}
          title={t("deadlines.remove")}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

function AddDeadlineForm({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useRefresh(caseId);
  const team = useQuery({ queryKey: ["team"], queryFn: api.team });
  const [key] = useState(newKey);
  const add = useMutation({
    mutationFn: (body: Parameters<typeof api.addDeadline>[1]) => api.addDeadline(caseId, body, key),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  // Read the clock once, when the form opens.
  const [tomorrow] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString("en-CA"),
  );

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const notes = String(data.get("notes") ?? "").trim();
    add.mutate({
      title: String(data.get("title") ?? "").trim(),
      // The browser reads date and time in the user's own time zone.
      dueAt: new Date(`${data.get("date")}T${data.get("time")}`).toISOString(),
      ownerId: String(data.get("owner")),
      remindBeforeHours: data.getAll("remind").map(Number),
      ...(notes ? { notes } : {}),
    });
  }

  return (
    <form className="reason" onSubmit={submit}>
      <Field label={t("deadlines.title")}>
        <input
          name="title"
          required
          minLength={2}
          maxLength={160}
          autoFocus
          placeholder={t("deadlines.titleHint")}
        />
      </Field>
      <div className="grid-3">
        <Field label={t("deadlines.date")}>
          <input name="date" type="date" required defaultValue={tomorrow} />
        </Field>
        <Field label={t("deadlines.time")}>
          <input name="time" type="time" required defaultValue="12:00" />
        </Field>
        <Field label={t("deadlines.owner")}>
          <select name="owner">
            {team.data?.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="checks">
        <legend>{t("deadlines.remind")}</legend>
        {REMINDER_CHOICES.map((h) => (
          <label key={h}>
            <input type="checkbox" name="remind" value={h} defaultChecked={h === 72 || h === 24} />
            {t(`deadlines.before.${h}`)}
          </label>
        ))}
      </fieldset>
      <Field label={t("deadlines.notes")} hint={t("cases.form.optional")}>
        <input name="notes" maxLength={1000} />
      </Field>
      <ErrorAlert message={errorText(add.error)} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn quiet" onClick={onDone}>
          {t("common.cancel")}
        </button>
        <button className="btn primary" disabled={add.isPending}>
          {t("deadlines.add")}
        </button>
      </div>
    </form>
  );
}

export function CaseDeadlinesCard({ caseId, closed }: { caseId: string; closed: boolean }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ["deadlines", { caseId }],
    queryFn: () => api.deadlines({ caseId, includeDone: true }),
  });

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("deadlines.heading")}</h2>
        {!closed && !adding && (
          <button className="btn quiet" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t("deadlines.add")}
          </button>
        )}
      </div>
      {list.data?.map((d) => (
        <DeadlineRow key={d.id} d={d} closed={closed} />
      ))}
      {list.data?.length === 0 && !adding && (
        <p className="muted" style={{ margin: 0, padding: "0 18px 16px" }}>
          {t("deadlines.none")}
        </p>
      )}
      {adding && <AddDeadlineForm caseId={caseId} onDone={() => setAdding(false)} />}
    </section>
  );
}
