import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field, Icon } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { ME_KEY, redirectSearch } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

export const Route = createFileRoute("/two-factor")({
  validateSearch: redirectSearch,
  component: TwoFactor,
});

function TwoFactor() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const router = useRouter();
  const { redirect: next } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (failed) return setError(errorText(failed, t("auth.invalidCode")));
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    router.history.push(next ?? "/");
  }

  return (
    <AuthLayout>
      <div>
        <span className="logo-mark" style={{ marginBottom: 14 }}>
          <Icon name="shield" />
        </span>
        <h1>{t("auth.twoFactorTitle")}</h1>
        <p className="muted">{t("auth.twoFactorLead")}</p>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label={t("auth.code")}>
          <input
            name="code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
            autoFocus
          />
        </Field>
        <ErrorAlert message={error} />
        <button className="btn primary block" disabled={busy}>
          {t("auth.verify")}
        </button>
      </form>
    </AuthLayout>
  );
}
