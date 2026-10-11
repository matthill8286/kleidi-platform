export type Locale = "en" | "el" | "ru";

type Rendered = { subject: string; text: string };

const ROLE_NAMES: Record<Locale, Record<string, string>> = {
  en: { firm_admin: "firm admin", lawyer: "lawyer", staff: "staff member" },
  el: { firm_admin: "διαχειριστής", lawyer: "δικηγόρος", staff: "μέλος προσωπικού" },
  ru: { firm_admin: "администратор", lawyer: "юрист", staff: "сотрудник" },
};

// Greek and Russian copy are drafts pending professional translation.
const TEMPLATES = {
  "firm-invitation": (locale: Locale, d: Record<string, string>): Rendered => {
    const role = ROLE_NAMES[locale][d.role ?? ""] ?? d.role ?? "";
    switch (locale) {
      case "el":
        return {
          subject: `Πρόσκληση στο ${d.firmName} στο Kleidi`,
          text: `${d.inviterName} σας προσκάλεσε να συμμετάσχετε στο ${d.firmName} ως ${role}.\n\nΑποδοχή πρόσκλησης: ${d.link}\n\nΟ σύνδεσμος λήγει σε 7 ημέρες.`,
        };
      case "ru":
        return {
          subject: `Приглашение в ${d.firmName} в Kleidi`,
          text: `${d.inviterName} приглашает вас в ${d.firmName} в роли: ${role}.\n\nПринять приглашение: ${d.link}\n\nСсылка действует 7 дней.`,
        };
      default:
        return {
          subject: `You're invited to ${d.firmName} on Kleidi`,
          text: `${d.inviterName} has invited you to join ${d.firmName} as a ${role}.\n\nAccept the invitation: ${d.link}\n\nThe link expires in 7 days.`,
        };
    }
  },
  "deadline-reminder": (locale: Locale, d: Record<string, string>): Rendered => {
    switch (locale) {
      case "el":
        return {
          subject: `Υπενθύμιση: ${d.title} λήγει ${d.due}`,
          text: `Η προθεσμία «${d.title}» λήγει ${d.due}.\n\nΆνοιγμα υπόθεσης: ${d.link}`,
        };
      case "ru":
        return {
          subject: `Напоминание: срок «${d.title}» истекает ${d.due}`,
          text: `Срок «${d.title}» истекает ${d.due}.\n\nОткрыть дело: ${d.link}`,
        };
      default:
        return {
          subject: `Reminder: ${d.title} is due ${d.due}`,
          text: `The deadline "${d.title}" is due ${d.due}.\n\nOpen the case: ${d.link}`,
        };
    }
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export function render(
  template: TemplateName,
  locale: Locale,
  data: Record<string, string>,
): Rendered {
  return TEMPLATES[template](locale, data);
}
