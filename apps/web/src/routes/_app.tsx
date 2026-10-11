import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, Icon, LanguageSwitch, Logo } from "../components/ui.tsx";
import { getActiveFirm, setActiveFirm } from "../lib/api.ts";
import { authClient } from "../lib/auth.ts";
import { loadMe } from "../lib/session.ts";

// Every signed-in page passes this gate: signed in, two-factor on, and a member of a firm.
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    if (!me.user.twoFactorEnabled)
      throw redirect({ to: "/security", search: { redirect: location.href } });
    if (me.firms.length === 0) throw redirect({ to: "/onboarding" });
    const firm = me.firms.find((f) => f.id === getActiveFirm()) ?? me.firms[0]!;
    setActiveFirm(firm.id);
    return { me, firm };
  },
  component: Shell,
});

function Shell() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me, firm, queryClient } = Route.useRouteContext();
  const { pathname } = useLocation();
  const inCases = pathname === "/" || pathname.startsWith("/cases");

  async function signOut() {
    await authClient.signOut();
    setActiveFirm(null);
    queryClient.clear();
    router.history.push("/sign-in");
  }

  const soon = (icon: "calendar" | "users" | "settings", label: string) => (
    <span className="soon-link">
      <Icon name={icon} />
      {label}
      <span className="soon">{t("nav.soon")}</span>
    </span>
  );

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/">
          <Logo />
        </Link>
        <div className="nav-label">{t("nav.workspace")}</div>
        <nav className="nav">
          <Link to="/" data-status={inCases ? "active" : undefined}>
            <Icon name="cases" />
            {t("nav.cases")}
          </Link>
          <Link to="/team">
            <Icon name="users" />
            {t("nav.team")}
          </Link>
          {soon("calendar", t("nav.calendar"))}
          {soon("settings", t("nav.settings"))}
        </nav>
        <div className="side-foot">
          <Avatar name={me.user.name} />
          <div>
            <b>{me.user.name}</b>
            <span>{firm.name}</span>
          </div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar">
          <span className="eyebrow" style={{ flex: 1 }}>
            {firm.name}
          </span>
          <LanguageSwitch />
          <button className="btn quiet" onClick={() => void signOut()}>
            <Icon name="logout" />
            {t("nav.signOut")}
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
