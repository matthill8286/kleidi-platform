import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { loadMe, ME_KEY, redirectSearch } from "../lib/session.ts";
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
  const router = useRouter();
  const { redirect: next } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.signUp.email({
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (failed) return setError(errorText(failed));
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    // New users secure their account before anything else.
    return router.navigate({ to: "/security", search: next ? { redirect: next } : {} });
  }

  return (
    <AuthLayout>
      <div>
        <h1>{t("auth.signUpTitle")}</h1>
        <p className="muted">{t("auth.signUpLead")}</p>
      </div>
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
