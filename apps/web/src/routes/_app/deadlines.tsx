import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DeadlineRow } from "../../components/deadlines.tsx";
import { Icon } from "../../components/ui.tsx";
import { api, type Urgency } from "../../lib/api.ts";

export const Route = createFileRoute("/_app/deadlines")({ component: DeadlinesPage });

const GROUPS: Urgency[] = ["overdue", "today", "week", "later", "done"];

function DeadlinesPage() {
  const { t } = useTranslation();
  const { firm } = Route.useRouteContext();
  const [mine, setMine] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const list = useQuery({
    queryKey: ["deadlines", { mine, showDone }],
    queryFn: () => api.deadlines({ mine, includeDone: showDone }),
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{firm.name}</div>
          <h1>{t("deadlines.pageTitle")}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {t("deadlines.lead")}
          </p>
        </div>
      </div>
      <div className="toolbar">
        <span className="seg">
          <button type="button" className={mine ? "on" : ""} onClick={() => setMine(true)}>
            {t("deadlines.mine")}
          </button>
          <button type="button" className={mine ? "" : "on"} onClick={() => setMine(false)}>
            {t("deadlines.everyone")}
          </button>
        </span>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          {t("deadlines.showDone")}
        </label>
      </div>

      {list.isPending && <p className="muted">{t("common.loading")}</p>}
      {list.data?.length === 0 && (
        <div className="card empty">
          <span className="logo-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
            <Icon name="calendar" />
          </span>
          <h2>{t("deadlines.emptyTitle")}</h2>
          <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
            {t("deadlines.emptyLead")}
          </p>
        </div>
      )}
      <div style={{ display: "grid", gap: 18 }}>
        {GROUPS.map((g) => {
          const items = list.data?.filter((d) => d.urgency === g) ?? [];
          if (items.length === 0) return null;
          return (
            <section className="card" key={g}>
              <div className="card-head">
                <h2>{t(`deadlines.groups.${g}`)}</h2>
                <span className="muted">{items.length}</span>
              </div>
              {items.map((d) => (
                <DeadlineRow key={d.id} d={d} showCase />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
