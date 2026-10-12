import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@kleidi/i18n";
import { api, type Party, type PortalAccess } from "../lib/api.ts";
import { useErrorText } from "../lib/errors.ts";
import { Avatar, ErrorAlert, Field, Icon } from "./ui.tsx";

/**
 * One party on a case: their contact details, which the portal needs, and their portal
 * access. Inviting sends an email link; the first visit texts a code to their phone.
 */
export function PartyRow({
  caseId,
  party,
  access,
  closed,
  onChanged,
}: {
  caseId: string;
  party: Party;
  access: PortalAccess | undefined;
  closed: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"view" | "edit" | "invite">("view");
  const after = async () => {
    await onChanged();
    await queryClient.invalidateQueries({ queryKey: ["case", caseId, "portal"] });
    await queryClient.invalidateQueries({ queryKey: ["case", caseId, "activity"] });
    setMode("view");
  };
  const save = useMutation({
    mutationFn: (body: { email: string | null; phone: string | null }) =>
      api.updateParty(caseId, party.id, body),
    onSuccess: after,
  });
  const invite = useMutation({
    mutationFn: (locale: string) => api.invitePortal(caseId, party.id, locale),
    onSuccess: after,
  });
  const revoke = useMutation({ mutationFn: () => api.revokePortal(access!.id), onSuccess: after });

  const active = access && !access.revokedAt;
  const reachable = Boolean(party.email && party.phone);
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage, { day: "numeric", month: "short" });

  function submitContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => String(data.get(k) ?? "").trim() || null;
    save.mutate({ email: value("email"), phone: value("phone") });
  }

  function submitInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    invite.mutate(String(new FormData(e.currentTarget).get("locale")));
  }

  return (
    <div className="party">
      <div className="list-row" style={{ borderTop: 0 }}>
        <Avatar name={party.fullName} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ color: "var(--ink)" }}>{party.fullName}</b>
          <div className="muted" style={{ overflowWrap: "anywhere" }}>
            {[party.email, party.phone].filter(Boolean).join(" · ") || t("portal.firm.noContact")}
          </div>
          {access && (
            <div className="muted">
              {access.revokedAt
                ? t("portal.firm.revoked")
                : access.lastSeenAt
                  ? t("portal.firm.lastSeen", { date: date(access.lastSeenAt) })
                  : t("portal.firm.invited", { date: date(access.createdAt) })}
            </div>
          )}
        </div>
        <span className="chip c-grey">{t(`cases.roles.${party.role}`)}</span>
      </div>
      {!closed && mode === "view" && (
        <div className="party-actions">
          <button className="btn quiet small" onClick={() => setMode("edit")}>
            {t("portal.firm.editContact")}
          </button>
          {reachable && (
            <button className="btn quiet small" onClick={() => setMode("invite")}>
              <Icon name="send" />
              {active ? t("portal.firm.reinvite") : t("portal.firm.invite")}
            </button>
          )}
          {active && (
            <button
              className="btn quiet small danger"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              <Icon name="x" />
              {t("portal.firm.revoke")}
            </button>
          )}
        </div>
      )}
      {mode === "edit" && (
        <form className="reason" onSubmit={submitContact}>
          <div className="grid-2">
            <Field label={t("cases.form.partyEmail")}>
              <input name="email" type="email" defaultValue={party.email ?? ""} autoFocus />
            </Field>
            <Field label={t("settings.phone")} hint={t("portal.firm.phoneHint")}>
              <input
                name="phone"
                type="tel"
                defaultValue={party.phone ?? ""}
                placeholder="+357 99 123456"
              />
            </Field>
          </div>
          <ErrorAlert message={errorText(save.error)} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={() => setMode("view")}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={save.isPending}>
              {t("cases.detail.save")}
            </button>
          </div>
        </form>
      )}
      {mode === "invite" && (
        <form className="reason" onSubmit={submitInvite}>
          <p className="muted" style={{ margin: 0 }}>
            {t("portal.firm.inviteLead", { email: party.email, phone: party.phone })}
          </p>
          <Field label={t("portal.firm.language")}>
            <select name="locale" defaultValue={i18n.resolvedLanguage ?? "en"}>
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </Field>
          <ErrorAlert message={errorText(invite.error)} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={() => setMode("view")}>
              {t("common.cancel")}
            </button>
            <button className="btn primary" disabled={invite.isPending}>
              <Icon name="send" />
              {t("portal.firm.send")}
            </button>
          </div>
        </form>
      )}
      <ErrorAlert message={errorText(revoke.error)} />
    </div>
  );
}
