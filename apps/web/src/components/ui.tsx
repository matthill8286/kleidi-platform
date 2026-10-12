import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@kleidi/i18n";
import { api } from "../lib/api.ts";

const PATHS: Record<string, string> = {
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  cases:
    '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  building:
    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  home: '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10z"/><path d="M9 22V12h6v10"/>',
};

export const Icon = ({ name }: { name: keyof typeof PATHS }) => (
  <svg
    className="i"
    viewBox="0 0 24 24"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: PATHS[name] ?? "" }}
  />
);

export const Logo = () => (
  <span className="logo" translate="no">
    <span className="logo-mark">
      <Icon name="key" />
    </span>
    <span className="logo-word">Kleidi</span>
  </span>
);

const PALETTE = ["#2a5ba8", "#2c7a53", "#8a4fa3", "#b4532a", "#1f7a8c", "#7a6a1f"];
export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="avatar"
      style={{ background: PALETTE[hash % PALETTE.length], width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const ErrorAlert = ({ message }: { message: string | null }) =>
  message ? (
    <div className="alert error" role="alert">
      {message}
    </div>
  ) : null;

/** Switches language. Signed in, the choice is saved, so emails follow it too. */
export function LanguageSwitch({ onPick }: { onPick?: (locale: string) => Promise<unknown> }) {
  const { i18n } = useTranslation();
  return (
    <span className="seg" aria-label="Language">
      {SUPPORTED_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={i18n.resolvedLanguage === l ? "on" : ""}
          title={LOCALE_NAMES[l]}
          onClick={() => {
            void i18n.changeLanguage(l);
            // Signed out, saving fails quietly.
            void (onPick ? onPick(l) : api.updateMe({ locale: l })).catch(() => undefined);
          }}
        >
          {l === "el" ? "ΕΛ" : l.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** Brand panel beside a form, used by every signed-out page. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo />
        <div>
          <h1>{t("auth.sideTitle")}</h1>
          <p>{t("auth.sideLead")}</p>
        </div>
        <span className="muted" style={{ color: "#8b96ad" }}>
          © {new Date().getFullYear()} Kleidi
        </span>
      </aside>
      <main className="auth-form">
        <div className="auth-card">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <LanguageSwitch />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
