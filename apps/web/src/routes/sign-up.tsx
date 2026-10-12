import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { loadMe, redirectSearch } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

export const Route = createFileRoute("/sign-up")({
  validateSearch: redirectSearch,
  beforeLoad: async ({ context, search }) => {
    const me = await loadMe(context.queryClient);
    if (me) throw redirect({ href: search.redirect ?? "/" });
  },
  component: SignUp,
});

function SignUp() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const { redirect: next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const email = String(form.get("email"));
    const { error: failed } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      // The emailed link signs them in and continues to two-factor setup.
      callbackURL: next ? `/security?redirect=${encodeURIComponent(next)}` : "/security",
    });
    setBusy(false);
    if (failed) return setError(errorText(failed));
    return setSentTo(email);
  }

  return (
    <AuthLayout>
      <div>
        <h1>{t("auth.signUpTitle")}</h1>
        <p className="muted">{t("auth.signUpLead")}</p>
      </div>
      {sentTo ? (
        <div className="alert ok">{t("auth.checkInbox", { email: sentTo })}</div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <Field label={t("auth.name")}>
            <input name="name" autoComplete="name" required minLength={2} />
          </Field>
          <Field label={t("auth.email")}>
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </Field>
          <ErrorAlert message={error} />
          <button className="btn accent block" disabled={busy}>
            {t("auth.signUp")}
          </button>
        </form>
      )}
      <p className="muted">
        {t("auth.haveAccount")}{" "}
        <Link
          to="/sign-in"
          search={next ? { redirect: next } : {}}
          style={{ color: "var(--accent)", fontWeight: 600 }}
        >
          {t("auth.signIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
