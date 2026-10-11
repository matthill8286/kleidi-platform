import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui.tsx";
import { api, type CaseStatus } from "../../lib/api.ts";
import { STATUS_CHIP, useStageLabels } from "../../lib/cases.ts";

export const Route = createFileRoute("/_app/")({ component: Cases });

const FILTERS: (CaseStatus | "")[] = ["", "open", "on_hold", "completed", "cancelled"];

function Cases() {
  const { t, i18n } = useTranslation();
  const { firm } = Route.useRouteContext();
  const navigate = useNavigate();
  const { label } = useStageLabels();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CaseStatus | "">("");
  const list = useInfiniteQuery({
    queryKey: ["cases", firm.id, q.trim(), status],
    queryFn: ({ pageParam }) =>
      api.listCases({
        q: q.trim(),
        ...(status ? { status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtering = q.trim() !== "" || status !== "";
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, { day: "numeric", month: "short" });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{firm.name}</div>
          <h1>{t("cases.title")}</h1>
        </div>
        <Link to="/cases/new" className="btn accent">
          <Icon name="plus" />
          {t("cases.new")}
        </Link>
      </div>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("cases.search")}
            aria-label={t("cases.search")}
          />
        </label>
        <span className="seg">
          {FILTERS.map((f) => (
            <button
              key={f || "all"}
              type="button"
              className={status === f ? "on" : ""}
              onClick={() => setStatus(f)}
            >
              {f ? t(`cases.statuses.${f}`) : t("cases.all")}
            </button>
          ))}
        </span>
      </div>

      {rows.length > 0 ? (
        <section className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>{t("cases.reference")}</th>
                <th>{t("cases.property")}</th>
                <th className="hide-sm">{t("cases.buyers")}</th>
                <th>{t("cases.stage")}</th>
                <th>{t("cases.status")}</th>
                <th className="hide-sm">{t("cases.updated")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => void navigate({ to: "/cases/$caseId", params: { caseId: c.id } })}
                >
                  <td>
                    <Link
                      to="/cases/$caseId"
                      params={{ caseId: c.id }}
                      className="ref"
                      translate="no"
                    >
                      {c.reference}
                    </Link>
                  </td>
                  <td className="clip">{c.propertyAddress}</td>
                  <td className="hide-sm clip">{c.buyers.join(", ")}</td>
                  <td>{label(c.currentStageKey)}</td>
                  <td>
                    <span className={`chip ${STATUS_CHIP[c.status]}`}>
                      {t(`cases.statuses.${c.status}`)}
                    </span>
                  </td>
                  <td className="hide-sm muted">{date(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.hasNextPage && (
            <div style={{ padding: 14, textAlign: "center", borderTop: "1px solid var(--line)" }}>
              <button
                className="btn"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {t("cases.loadMore")}
              </button>
            </div>
          )}
        </section>
      ) : list.isPending ? (
        <p className="muted">{t("common.loading")}</p>
      ) : filtering ? (
        <div className="card empty">
          <p className="muted">{t("cases.noMatches")}</p>
        </div>
      ) : (
        <div className="card empty">
          <span className="logo-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
            <Icon name="cases" />
          </span>
          <h2>{t("cases.empty")}</h2>
          <p className="muted" style={{ maxWidth: 420, margin: 0 }}>
            {t("cases.emptyLead")}
          </p>
          <Link to="/cases/new" className="btn accent" style={{ marginTop: 6 }}>
            <Icon name="plus" />
            {t("cases.new")}
          </Link>
        </div>
      )}
    </div>
  );
}
