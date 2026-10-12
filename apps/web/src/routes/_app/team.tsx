import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, ErrorAlert, Field, Icon } from "../../components/ui.tsx";
import { api, type Role } from "../../lib/api.ts";
import { useErrorText } from "../../lib/errors.ts";

export const Route = createFileRoute("/_app/team")({ component: TeamPage });

const ROLE_CHIP: Record<Role, string> = {
  firm_admin: "c-blue",
  lawyer: "c-green",
  staff: "c-grey",
};

function TeamPage() {
  const { t, i18n } = useTranslation();
  const { me, firm } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const errorText = useErrorText();
  const team = useQuery({ queryKey: ["team", firm.id], queryFn: api.team });
  const [sent, setSent] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: Role }) => api.invite(email, role),
    onSuccess: async (invitation) => {
      setSent(t("team.sent", { email: invitation.email }));
      await queryClient.invalidateQueries({ queryKey: ["team", firm.id] });
    },
  });
  const isAdmin = firm.role === "firm_admin";
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, { day: "numeric", month: "short" });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setSent(null);
    invite.mutate(
      { email: String(data.get("email")), role: data.get("role") as Role },
      { onSuccess: () => form.reset() },
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{firm.name}</div>
          <h1>{t("team.title")}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {t("team.lead")}
          </p>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 18,
          alignItems: "start",
        }}
        className="team-grid"
      >
        <div style={{ display: "grid", gap: 18 }}>
          <section className="card">
            <div style={{ padding: "16px 18px 6px" }}>
              <h2>{t("team.members")}</h2>
            </div>
            {team.data?.members.map((m) => (
              <div className="list-row" key={m.userId}>
                <Avatar name={m.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ color: "var(--ink)" }}>
                    {m.name}{" "}
                    {m.userId === me.user.id && <span className="muted">· {t("team.you")}</span>}
                  </b>
                  <div className="muted">{m.email}</div>
                </div>
                <span className={`chip ${ROLE_CHIP[m.role]}`}>{t(`team.roles.${m.role}`)}</span>
              </div>
            ))}
            {team.isPending && (
              <p className="muted" style={{ padding: 18 }}>
                {t("common.loading")}
              </p>
            )}
          </section>
          {team.data && team.data.invitations.length > 0 && (
            <section className="card">
              <div style={{ padding: "16px 18px 6px" }}>
                <h2>{t("team.pending")}</h2>
              </div>
              {team.data.invitations.map((inv) => (
                <div className="list-row" key={inv.id}>
                  <span
                    className="avatar"
                    style={{ background: "var(--surface-2)", color: "var(--muted)" }}
                  >
                    <Icon name="send" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ color: "var(--ink)" }}>{inv.email}</b>
                    <div className="muted">{t("team.expires", { date: date(inv.expiresAt) })}</div>
                  </div>
                  <span className={`chip ${ROLE_CHIP[inv.role]}`}>
                    {t(`team.roles.${inv.role}`)}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>
        <section className="card" style={{ padding: 20 }}>
          <h2 style={{ marginBottom: 14 }}>{t("team.invite")}</h2>
          {isAdmin ? (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <Field label={t("auth.email")}>
                <input name="email" type="email" required placeholder="andreas@christou.example" />
              </Field>
              <Field label={t("team.role")}>
                <select name="role" defaultValue="lawyer">
                  {(["lawyer", "staff", "firm_admin"] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`team.roles.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <ErrorAlert message={errorText(invite.error)} />
              {sent && <div className="alert ok">{sent}</div>}
              <button className="btn accent block" disabled={invite.isPending}>
                <Icon name="send" />
                {t("team.send")}
              </button>
            </form>
          ) : (
            <p className="muted">{t("team.adminsOnly")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
