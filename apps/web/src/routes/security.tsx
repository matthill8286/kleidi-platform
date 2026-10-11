import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Field, Icon } from "../components/ui.tsx";
import { authClient } from "../lib/auth.ts";
import { loadMe, ME_KEY, redirectSearch } from "../lib/session.ts";

export const Route = createFileRoute("/security")({
  validateSearch: redirectSearch,
  beforeLoad: async ({ context, search, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (me.user.twoFactorEnabled) throw redirect({ href: search.redirect ?? "/" });
  },
  component: Security,
});

type Setup = { qr: string; secret: string; backupCodes: string[] };

function Security() {
  const { t } = useTranslation();
  const router = useRouter();
  const { redirect: next } = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: failed } = await authClient.twoFactor.enable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (failed || !data || data.method !== "totp")
      return setError(failed?.message ?? t("common.error"));
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({
      qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 }),
      secret,
      backupCodes: data.backupCodes,
    });
  }

  async function activate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const { error: failed } = await authClient.twoFactor.verifyTotp({ code });
    setBusy(false);
    if (failed) return setError(t("auth.invalidCode"));
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    router.history.push(next ?? "/");
  }

  return (
    <AuthLayout>
      <div>
        <span className="logo-mark" style={{ marginBottom: 14 }}>
          <Icon name="shield" />
        </span>
        <h1>{t("security.title")}</h1>
        <p className="muted">{t("security.lead")}</p>
      </div>
      {!setup ? (
        <form onSubmit={start} style={{ display: "grid", gap: 14 }}>
          <Field label={t("security.confirmPassword")}>
            <input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <ErrorAlert message={error} />
          <button className="btn primary block" disabled={busy}>
            {t("security.start")}
          </button>
        </form>
      ) : (
        <form onSubmit={activate} style={{ display: "grid", gap: 16 }}>
          <div
            className="card"
            style={{
              padding: 18,
              display: "grid",
              gap: 12,
              justifyItems: "center",
              textAlign: "center",
            }}
          >
            <p className="muted" style={{ margin: 0 }}>
              {t("security.scan")}
            </p>
            <img src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} />
            <span className="muted">{t("security.manual")}</span>
            <code
              style={{
                fontSize: 13,
                background: "var(--surface-2)",
                padding: "6px 10px",
                borderRadius: 8,
                wordBreak: "break-all",
              }}
            >
              {setup.secret}
            </code>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <h2>{t("security.backupTitle")}</h2>
            <p className="muted">{t("security.backupHint")}</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 13,
              }}
            >
              {setup.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
          <Field label={t("security.enterCode")}>
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
          <button className="btn accent block" disabled={busy}>
            {t("security.activate")}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
