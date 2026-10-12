import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LanguageSwitch, Logo } from "../components/ui.tsx";
import { portal } from "../lib/portal.ts";

// The client portal has its own plain frame: no firm navigation, nothing firm-internal.
export const Route = createFileRoute("/portal")({ component: PortalLayout });

function PortalLayout() {
  return (
    <div className="portal">
      <header className="portal-head">
        <Logo />
        <span style={{ flex: 1 }} />
        <LanguageSwitch onPick={(l) => portal.setLocale(l)} />
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
