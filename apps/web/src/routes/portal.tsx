import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LanguageSwitch, Logo } from "../components/ui.tsx";
import { portal, type PortalMe } from "../lib/portal.ts";

// The client portal has its own plain frame: no firm navigation, nothing firm-internal.
export const Route = createFileRoute("/portal")({ component: PortalLayout });

function PortalLayout() {
  const queryClient = useQueryClient();
  // The case page follows the saved language, so update the cached copy first. Otherwise it
  // switches the reader straight back before the save comes back.
  const pick = (locale: string) => {
    queryClient.setQueryData<PortalMe>(["portal", "me"], (me) => (me ? { ...me, locale } : me));
    return portal.setLocale(locale);
  };
  return (
    <div className="portal">
      <header className="portal-head">
        <Logo />
        <span style={{ flex: 1 }} />
        <LanguageSwitch onPick={pick} />
      </header>
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
