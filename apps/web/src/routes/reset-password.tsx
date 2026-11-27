import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { ME_KEY } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

// The emailed link lands here with ?token=. Better Auth checks it, uses it once and
// signs the account out everywhere.
export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" && search.token ? { token: search.token } : {},
  component: ResetPassword,
});

function ResetPassword() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { token } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(token ? null : t("auth.resetLinkInvalid"));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError(t("auth.passwordsDiffer"));
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.resetPassword({ newPassword, token });
    setBusy(false);
    if (failed) return setError(errorText(failed));
    // Any session in this browser was just revoked too.
    queryClient.removeQueries({ queryKey: ME_KEY });
    return setDone(true);
  }

  return (
    <AuthLayout>
      <div>
        <h1>{t("auth.resetTitle")}</h1>
        <p className="muted">{t("auth.resetLead")}</p>
      </div>
      {done ? (
        <div className="alert ok">{t("auth.resetDone")}</div>
      ) : token ? (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </Field>
          <Field label={t("auth.confirmNewPassword")}>
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </Field>
          <ErrorAlert message={error} />
          <button className="btn primary block" disabled={busy}>
            {t("auth.resetPassword")}
          </button>
        </form>
      ) : (
        <ErrorAlert message={error} />
      )}
      <p className="muted">
        <Link
          to={done || token ? "/sign-in" : "/forgot-password"}
          style={{ color: "var(--accent)", fontWeight: 600 }}
        >
          {done || token ? t("auth.backToSignIn") : t("auth.forgotTitle")}
        </Link>
      </p>
    </AuthLayout>
  );
}
