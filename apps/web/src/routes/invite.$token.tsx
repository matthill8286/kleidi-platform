import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout, ErrorAlert, Icon } from "../components/ui.tsx";
import { api, setActiveFirm } from "../lib/api.ts";
import { loadMe, ME_KEY } from "../lib/session.ts";
import { useErrorText } from "../lib/errors.ts";

export const Route = createFileRoute("/invite/$token")({
  loader: ({ context }) => loadMe(context.queryClient),
  component: Invite,
});

function Invite() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const router = useRouter();
  const me = Route.useLoaderData();
  const { token } = Route.useParams();
  const { queryClient } = Route.useRouteContext();
  const here = `/invite/${token}`;
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.previewInvitation(token),
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const { firmId } = await api.acceptInvitation(token);
      setActiveFirm(firmId);
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
      router.history.push("/");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const p = preview.data;
  return (
    <AuthLayout>
      <span className="logo-mark">
        <Icon name="users" />
      </span>
      {preview.isPending && <p className="muted">{t("common.loading")}</p>}
      {preview.isError && <ErrorAlert message={t("invite.invalid")} />}
      {p && (
        <>
          <div>
            <h1>{t("invite.title", { firm: p.firmName })}</h1>
            <p className="muted">
              {t("invite.lead", { role: t(`team.roles.${p.role}`), email: p.email })}
            </p>
          </div>
          {p.state === "expired" && <ErrorAlert message={t("invite.expired")} />}
          {p.state === "accepted" && <ErrorAlert message={t("invite.used")} />}
          {p.state === "pending" && !me && (
            <div style={{ display: "grid", gap: 10 }}>
              <Link className="btn accent block" to="/sign-up" search={{ redirect: here }}>
                {t("invite.signUpFirst")}
              </Link>
              <Link className="btn block" to="/sign-in" search={{ redirect: here }}>
                {t("invite.signInFirst")}
              </Link>
            </div>
          )}
          {p.state === "pending" && me && !me.user.twoFactorEnabled && (
            <Link className="btn accent block" to="/security" search={{ redirect: here }}>
              {t("security.start")}
            </Link>
          )}
          {p.state === "pending" && me?.user.twoFactorEnabled && (
            <>
              <ErrorAlert message={error} />
              <button className="btn accent block" onClick={() => void accept()} disabled={busy}>
                {t("invite.accept")}
              </button>
            </>
          )}
        </>
      )}
    </AuthLayout>
  );
}
