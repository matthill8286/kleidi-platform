import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { loadMe, ME_KEY, redirectSearch } from "../lib/session.ts";

export const Route = createFileRoute("/sign-in")({
  validateSearch: redirectSearch,
  beforeLoad: async ({ context, search }) => {
    const me = await loadMe(context.queryClient);
    if (me) throw redirect({ href: search.redirect ?? "/" });
  },
  component: SignIn,
});

function SignIn() {
  const { t } = useTranslation();
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
    const { data, error: failed } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setBusy(false);
    if (failed) return setError(t("auth.invalidCredentials"));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      return router.navigate({ to: "/two-factor", search: next ? { redirect: next } : {} });
    }
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    router.history.push(next ?? "/");
  }

  return (
    <AuthLayout>
      <div>
        <h1>{t("auth.signInTitle")}</h1>
        <p className="muted">{t("auth.signInLead")}</p>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label={t("auth.email")}>
          <input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("auth.password")}>
          <input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <ErrorAlert message={error} />
        <button className="btn primary block" disabled={busy}>
          {t("auth.signIn")}
        </button>
      </form>
      <p className="muted">
        {t("auth.noAccount")}{" "}
        <Link
          to="/sign-up"
          search={next ? { redirect: next } : {}}
          style={{ color: "var(--accent)", fontWeight: 600 }}
        >
          {t("auth.signUp")}
        </Link>
      </p>
    </AuthLayout>
  );
}
