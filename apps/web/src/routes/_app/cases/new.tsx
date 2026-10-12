import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorAlert, Field, Icon } from "../../../components/ui.tsx";
import {
  api,
  type NewCase,
  type PartyInput,
  type PartyRole,
  type PropertyType,
} from "../../../lib/api.ts";
import { newKey } from "../../../lib/cases.ts";
import { useErrorText } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_app/cases/new")({ component: NewCasePage });

const ROLES: PartyRole[] = ["buyer", "seller", "developer", "bank"];
const TYPES: PropertyType[] = ["resale", "offplan", "land"];
const blank = (role: PartyRole): PartyInput => ({ role, fullName: "", email: "", phone: "" });

function NewCasePage() {
  const { t } = useTranslation();
  const { firm } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  // One key per form: a double submit or a retry after a dropped connection opens one case.
  const [key] = useState(newKey);
  const [parties, setParties] = useState<PartyInput[]>([blank("buyer"), blank("seller")]);
  const [local, setLocal] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: (body: NewCase) => api.openCase(body, key),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["cases", firm.id] });
      queryClient.setQueryData(["case", created.id], created);
      await navigate({ to: "/cases/$caseId", params: { caseId: created.id } });
    },
  });

  const update = (i: number, patch: Partial<PartyInput>) =>
    setParties((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const filled = parties
      .filter((p) => p.fullName.trim())
      .map((p) => ({
        role: p.role,
        fullName: p.fullName.trim(),
        ...(p.email?.trim() ? { email: p.email.trim() } : {}),
        ...(p.phone?.trim() ? { phone: p.phone.trim() } : {}),
      }));
    if (!filled.some((p) => p.role === "buyer")) return setLocal(t("cases.form.needBuyer"));
    setLocal(null);
    open.mutate({
      propertyAddress: text("address"),
      propertyType: text("type") as PropertyType,
      ...(text("plot") ? { plotOrRegNo: text("plot") } : {}),
      ...(text("developer") ? { developerName: text("developer") } : {}),
      parties: filled,
    });
  }

  const serverError = errorText(open.error);

  return (
    <div className="page narrow">
      <Link to="/" className="back">
        <Icon name="arrowLeft" />
        {t("cases.detail.back")}
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{firm.name}</div>
          <h1>{t("cases.form.title")}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {t("cases.form.lead")}
          </p>
        </div>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <section className="card form-card">
          <h2>{t("cases.form.propertySection")}</h2>
          <Field label={t("cases.form.address")}>
            <input
              name="address"
              required
              minLength={3}
              maxLength={300}
              placeholder="12 Anexartisias, Limassol 3036"
            />
          </Field>
          <div className="grid-2">
            <Field label={t("cases.form.type")}>
              <select name="type" defaultValue="resale">
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`cases.types.${ty}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("cases.form.plot")} hint={t("cases.form.optional")}>
              <input name="plot" maxLength={80} placeholder="0/12345" />
            </Field>
          </div>
          <Field label={t("cases.form.developer")} hint={t("cases.form.optional")}>
            <input name="developer" maxLength={160} />
          </Field>
        </section>

        <section className="card form-card">
          <h2>{t("cases.form.partiesSection")}</h2>
          {parties.map((p, i) => (
            <div className="party-row" key={i}>
              <Field label={t("cases.form.partyRole")}>
                <select
                  value={p.role}
                  onChange={(e) => update(i, { role: e.target.value as PartyRole })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`cases.roles.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("cases.form.partyName")}>
                <input
                  value={p.fullName}
                  maxLength={160}
                  onChange={(e) => update(i, { fullName: e.target.value })}
                />
              </Field>
              <Field label={t("cases.form.partyEmail")}>
                <input
                  type="email"
                  value={p.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                />
              </Field>
              <Field label={t("cases.form.partyPhone")}>
                <input
                  type="tel"
                  value={p.phone}
                  maxLength={40}
                  onChange={(e) => update(i, { phone: e.target.value })}
                />
              </Field>
              <button
                type="button"
                className="btn quiet icon-btn"
                aria-label={t("cases.form.remove")}
                title={t("cases.form.remove")}
                disabled={parties.length === 1}
                onClick={() => setParties((ps) => ps.filter((_, j) => j !== i))}
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => setParties((ps) => [...ps, blank("buyer")])}
            >
              <Icon name="plus" />
              {t("cases.form.addParty")}
            </button>
          </div>
        </section>

        <ErrorAlert message={local ?? serverError} />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link to="/" className="btn quiet">
            {t("common.cancel")}
          </Link>
          <button className="btn accent" disabled={open.isPending}>
            <Icon name="check" />
            {t("cases.form.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
