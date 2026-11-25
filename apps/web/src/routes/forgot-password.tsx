import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { loadMe } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (me) throw redirect({ to: "/" });
  },
  component: ForgotPassword,
});

function ForgotPassword() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setBusy(true);
    setError(null);
    // The answer is the same whether or not the address has an account.
    const { error: failed } = await authClient.requestPasswordReset({ email });
    setBusy(false);
    if (failed) return setError(errorText(failed));
    return setSentTo(email);
  }

  return (
    <AuthLayout>
      <div>
        <h1>{t("auth.forgotTitle")}</h1>
        <p className="muted">{t("auth.forgotLead")}</p>
      </div>
      {sentTo ? (
        <div className="alert ok">{t("auth.resetLinkSent", { email: sentTo })}</div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <Field label={t("auth.email")}>
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          <ErrorAlert message={error} />
          <button className="btn primary block" disabled={busy}>
            {t("auth.sendResetLink")}
          </button>
        </form>
      )}
      <p className="muted">
        <Link to="/sign-in" style={{ color: "var(--accent)", fontWeight: 600 }}>
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
