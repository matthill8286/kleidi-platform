import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorAlert, Field, Icon } from "../../components/ui.tsx";
import { useErrorText } from "../../lib/errors.ts";
import { portal } from "../../lib/portal.ts";

export const Route = createFileRoute("/portal/sign-in")({ component: PortalSignIn });

/** Clients sign in with a fresh emailed link; the answer never reveals who is a client. */
function PortalSignIn() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const send = useMutation({ mutationFn: portal.requestLink });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send.mutate(String(new FormData(e.currentTarget).get("email") ?? "").trim());
  }

  return (
    <section className="card portal-card">
      <h1>{t("portal.signIn.title")}</h1>
      <p className="muted">{t("portal.signIn.lead")}</p>
      {send.isSuccess ? (
        <div className="alert ok">{t("portal.signIn.sent")}</div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <Field label={t("auth.email")}>
            <input name="email" type="email" required autoComplete="email" />
          </Field>
          <ErrorAlert message={errorText(send.error)} />
          <button className="btn primary block" disabled={send.isPending}>
            <Icon name="send" />
            {t("portal.signIn.send")}
          </button>
        </form>
      )}
    </section>
  );
}
