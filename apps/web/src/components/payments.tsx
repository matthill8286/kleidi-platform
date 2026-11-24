import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Payment } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { ErrorAlert, Field, Icon } from "./ui.tsx";

export const money = (minor: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);

const today = () => new Date().toISOString().slice(0, 10);

/** The schedule as a list: amount, due date, where to pay and whether it is paid. */
export function PaymentList({
  payments,
  actions,
}: {
  payments: Payment[];
  actions?: ((p: Payment) => React.ReactNode) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? "en";
  const date = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const due = payments.filter((p) => p.status === "due");
  const total = (list: Payment[]) =>
    list.length
      ? money(
          list.reduce((s, p) => s + p.amountMinor, 0),
          list[0]!.currency,
          lang,
        )
      : null;

  if (payments.length === 0)
    return (
      <p className="muted" style={{ margin: "0 18px 18px" }}>
        {t("payments.empty")}
      </p>
    );
  return (
    <div style={{ padding: "0 18px 18px", display: "grid", gap: 8 }}>
      {payments.map((p) => {
        const overdue = p.status === "due" && p.dueOn !== null && p.dueOn < today();
        return (
          <div key={p.id} className="doc-row" style={{ alignItems: "start" }}>
            <div className="doc-main">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b>{p.label}</b>
                <span
                  className={`chip ${p.status === "paid" ? "c-green" : overdue ? "c-red" : "c-amber"}`}
                >
                  {p.status === "paid"
                    ? p.paidOn
                      ? t("payments.paidOn", { date: date(p.paidOn) })
                      : t("payments.paid")
                    : overdue
                      ? t("payments.overdue")
                      : t("payments.due")}
                </span>
              </div>
              <div>
                <b>{money(p.amountMinor, p.currency, lang)}</b>
                {p.dueOn && (
                  <span className="muted"> · {t("payments.dueOn", { date: date(p.dueOn) })}</span>
                )}
              </div>
              {p.payTo && <div className="muted">{t("payments.payTo", { to: p.payTo })}</div>}
            </div>
            {actions && <div className="doc-actions">{actions(p)}</div>}
          </div>
        );
      })}
      {due.length > 0 && (
        <div className="muted" style={{ textAlign: "right" }}>
          {t("payments.stillDue", { amount: total(due) })}
        </div>
      )}
    </div>
  );
}

/** The firm keeps the schedule here; the client sees it in the portal. */
export function PaymentsCard({ caseId, closed }: { caseId: string; closed: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const key = ["case", caseId, "payments"];
  const list = useQuery({ queryKey: key, queryFn: () => api.payments(caseId) });
  const [adding, setAdding] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] }),
    ]);
  const add = useMutation({
    mutationFn: (body: Parameters<typeof api.addPayment>[1]) => api.addPayment(caseId, body),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (p: Payment) =>
      api.updatePayment(
        p.id,
        p.status === "due" ? { status: "paid", paidOn: today() } : { status: "due" },
      ),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (p: Payment) => api.removePayment(p.id),
    onSettled: refresh,
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => String(data.get(k) ?? "").trim();
    add.mutate({
      label: text("label"),
      amountMinor: Math.round(Number(text("amount").replace(/[^\d.]/g, "")) * 100),
      ...(text("dueOn") ? { dueOn: text("dueOn") } : {}),
      ...(text("payTo") ? { payTo: text("payTo") } : {}),
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t("payments.title")}</h2>
        {!closed && !adding && (
          <button className="btn quiet" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            {t("payments.add")}
          </button>
        )}
      </div>
      {adding && (
        <form className="reason" onSubmit={submit} style={{ margin: "0 18px 14px" }}>
          <div className="grid-2">
            <Field label={t("payments.label")}>
              <input
                name="label"
                required
                minLength={2}
                maxLength={120}
                placeholder={t("payments.labelExample")}
                autoFocus
              />
            </Field>
            <Field label={t("payments.amount")}>
              <input name="amount" required inputMode="decimal" placeholder="30000" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label={t("payments.dueDate")} hint={t("cases.form.optional")}>
              <input name="dueOn" type="date" />
            </Field>
            <Field label={t("payments.payToLabel")} hint={t("cases.form.optional")}>
              <input name="payTo" maxLength={300} placeholder={t("payments.payToExample")} />
            </Field>
          </div>
          <ErrorAlert message={errorText(add.error)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn small accent" disabled={add.isPending}>
              {t("payments.save")}
            </button>
            <button type="button" className="btn small quiet" onClick={() => setAdding(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
      <PaymentList
        payments={list.data ?? []}
        actions={
          closed
            ? undefined
            : (p) => (
                <>
                  <button
                    className="btn small"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(p)}
                  >
                    <Icon name={p.status === "due" ? "check" : "x"} />
                    {p.status === "due" ? t("payments.markPaid") : t("payments.markDue")}
                  </button>
                  <button
                    className="btn small quiet icon-btn"
                    aria-label={t("payments.remove")}
                    title={t("payments.remove")}
                    onClick={() => remove.mutate(p)}
                  >
                    <Icon name="x" />
                  </button>
                </>
              )
        }
      />
    </section>
  );
}
