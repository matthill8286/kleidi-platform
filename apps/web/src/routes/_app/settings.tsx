import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@kleidi/i18n";
import { ErrorAlert, Field, Icon } from "../../components/ui.tsx";
import { api } from "../../lib/api.ts";
import { useErrorText } from "../../lib/errors.ts";
import { ME_KEY } from "../../lib/session.ts";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: api.updateMe,
    onSuccess: async (_, body) => {
      if (body.locale) await i18n.changeLanguage(body.locale);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      setSaved(true);
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const phone = String(data.get("phone") ?? "").trim();
    setSaved(false);
    save.mutate({
      locale: String(data.get("locale")),
      phone: phone || null,
      smsReminders: data.get("sms") === "on",
    });
  }

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">{me.user.email}</div>
          <h1>{t("settings.title")}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {t("settings.lead")}
          </p>
        </div>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <section className="card form-card">
          <h2>{t("settings.notifications")}</h2>
          <Field label={t("settings.language")} hint={t("settings.languageHint")}>
            <select name="locale" defaultValue={me.user.locale}>
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.phone")} hint={t("settings.phoneHint")}>
            <input
              name="phone"
              type="tel"
              defaultValue={me.user.phone ?? ""}
              placeholder="+357 99 123456"
              maxLength={40}
            />
          </Field>
          <label className="inline-check">
            <input type="checkbox" name="sms" defaultChecked={me.user.smsReminders} />
            {t("settings.sms")}
          </label>
          <ErrorAlert message={errorText(save.error)} />
          {saved && <div className="alert ok">{t("settings.saved")}</div>}
          <div>
            <button className="btn primary" disabled={save.isPending}>
              <Icon name="check" />
              {t("settings.save")}
            </button>
          </div>
        </section>
        <section className="card form-card">
          <h2>{t("settings.security")}</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="chip c-green">{t("settings.twoFactorOn")}</span>
            <span className="muted">{t("settings.securityLead")}</span>
          </div>
        </section>
      </form>
    </div>
  );
}
