import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field, Icon } from "../components/ui.tsx";
import { api, setActiveFirm } from "../lib/api.ts";
import { loadMe, ME_KEY } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (!me.user.twoFactorEnabled)
      throw redirect({ to: "/security", search: { redirect: location.href } });
    if (me.firms.length > 0) throw redirect({ to: "/" });
  },
  component: Onboarding,
});

function Onboarding() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const firm = await api.createFirm(String(new FormData(e.currentTarget).get("name")));
      setActiveFirm(firm.id);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      router.history.push("/team");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div>
        <span className="logo-mark" style={{ marginBottom: 14 }}>
          <Icon name="building" />
        </span>
        <h1>{t("onboarding.title")}</h1>
        <p className="muted">{t("onboarding.lead")}</p>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <Field label={t("onboarding.firmName")}>
          <input
            name="name"
            required
            minLength={2}
            maxLength={120}
            placeholder="Christou & Co LLC"
            autoFocus
          />
        </Field>
        <ErrorAlert message={error} />
        <button className="btn accent block" disabled={busy}>
          {t("onboarding.create")}
        </button>
      </form>
    </AuthLayout>
  );
}
