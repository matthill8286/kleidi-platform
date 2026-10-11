import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui.tsx";

export const Route = createFileRoute("/_app/")({ component: Cases });

// Placeholder until milestone 2 brings case tracking.
function Cases() {
  const { t } = useTranslation();
  const { firm } = Route.useRouteContext();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{firm.name}</div>
          <h1>{t("cases.title")}</h1>
        </div>
      </div>
      <div
        className="card"
        style={{
          padding: "48px 24px",
          textAlign: "center",
          display: "grid",
          justifyItems: "center",
          gap: 10,
        }}
      >
        <span className="logo-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
          <Icon name="cases" />
        </span>
        <h2>{t("cases.empty")}</h2>
        <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
          {t("cases.emptyLead")}
        </p>
        <Link to="/team" className="btn accent" style={{ marginTop: 6 }}>
          <Icon name="users" />
          {t("team.invite")}
        </Link>
      </div>
    </div>
  );
}
