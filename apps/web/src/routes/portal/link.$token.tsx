import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorAlert, Field, Icon } from "../../components/ui.tsx";
import { useErrorText } from "../../lib/errors.ts";
import { portal } from "../../lib/portal.ts";

export const Route = createFileRoute("/portal/link/$token")({ component: PortalLink });

/** The emailed link, then the texted code: both are needed to open the case. */
function PortalLink() {
  const { t, i18n } = useTranslation();
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const errorText = useErrorText();
  // Opening the link texts a code; reloading the page does not send another.
  const info = useQuery({
    queryKey: ["portal-link", token],
    queryFn: () => portal.start(token),
    staleTime: Infinity,
    retry: false,
  });
  const resend = useMutation({ mutationFn: () => portal.start(token, true) });
  const verify = useMutation({
    mutationFn: (code: string) => portal.verify(token, code),
    onSuccess: () => navigate({ to: "/portal" }),
  });

  // The firm chose the client's language when inviting them.
  const locale = info.data?.locale;
  useEffect(() => {
    if (locale && locale !== i18n.resolvedLanguage) void i18n.changeLanguage(locale);
  }, [locale, i18n]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    verify.mutate(String(new FormData(e.currentTarget).get("code") ?? "").trim());
  }

  if (info.isError) {
    return (
      <section className="card portal-card">
        <h1>{t("portal.link.problem")}</h1>
        <ErrorAlert message={errorText(info.error)} />
        <Link to="/portal/sign-in" className="btn primary">
          {t("portal.link.newLink")}
        </Link>
      </section>
    );
  }

  return (
    <section className="card portal-card">
      <h1>
        {info.data ? t("portal.link.hello", { name: info.data.partyName }) : t("common.loading")}
      </h1>
      {info.data && (
        <>
          <p className="muted">
            {t("portal.link.lead", { firm: info.data.firmName, phone: info.data.maskedPhone })}
          </p>
          <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
            <Field label={t("auth.code")}>
              <input
                name="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                autoFocus
              />
            </Field>
            <ErrorAlert message={errorText(verify.error ?? resend.error)} />
            {resend.isSuccess && <div className="alert ok">{t("portal.link.resent")}</div>}
            <button className="btn primary block" disabled={verify.isPending}>
              <Icon name="key" />
              {t("portal.link.open")}
            </button>
            <button
              type="button"
              className="btn quiet"
              disabled={resend.isPending}
              onClick={() => resend.mutate()}
            >
              {t("portal.link.resend")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
