export type Locale = "en" | "el" | "ru";

export type Rendered = { subject: string; text: string };

const ROLE_NAMES: Record<Locale, Record<string, string>> = {
  en: { firm_admin: "firm admin", lawyer: "lawyer", staff: "staff member" },
  el: { firm_admin: "διαχειριστής", lawyer: "δικηγόρος", staff: "μέλος προσωπικού" },
  ru: { firm_admin: "администратор", lawyer: "юрист", staff: "сотрудник" },
};

export type DigestLine = { caseReference: string; title: string; when: string };

export type TemplateData = {
  "firm-invitation": { firmName: string; inviterName: string; role: string; link: string };
  "deadline-reminder": { title: string; caseReference: string; due: string; link: string };
  "deadline-reminder-sms": { title: string; caseReference: string; due: string };
  "document-expiring": {
    title: string;
    caseReference: string;
    state: "expiring" | "expired";
    date: string;
    link: string;
  };
  "daily-digest": {
    name: string;
    overdue: DigestLine[];
    upcoming: DigestLine[];
    documents: DigestLine[];
    // Cases that moved on with checklist items unfinished in earlier stages.
    gaps: { caseReference: string; count: number }[];
    link: string;
  };
};

export type TemplateName = keyof TemplateData;

type Copy<T> = Record<Locale, (d: T) => Rendered>;

const lines = (items: DigestLine[]) =>
  items
    .map((i) => `  • ${[i.caseReference, i.title, i.when].filter(Boolean).join(" · ")}`)
    .join("\n");

/** Joins the digest sections that have entries, under their headings. */
const sections = (parts: [string, DigestLine[]][]) =>
  parts
    .filter(([, items]) => items.length > 0)
    .map(([heading, items]) => `${heading}\n${lines(items)}`)
    .join("\n\n");

// Greek and Russian copy are drafts pending professional translation.
const TEMPLATES: { [K in TemplateName]: Copy<TemplateData[K]> } = {
  "firm-invitation": {
    en: (d) => ({
      subject: `You're invited to ${d.firmName} on Kleidi`,
      text: `${d.inviterName} has invited you to join ${d.firmName} as a ${ROLE_NAMES.en[d.role] ?? d.role}.\n\nAccept the invitation: ${d.link}\n\nThe link expires in 7 days.`,
    }),
    el: (d) => ({
      subject: `Πρόσκληση στο ${d.firmName} στο Kleidi`,
      text: `${d.inviterName} σας προσκάλεσε να συμμετάσχετε στο ${d.firmName} ως ${ROLE_NAMES.el[d.role] ?? d.role}.\n\nΑποδοχή πρόσκλησης: ${d.link}\n\nΟ σύνδεσμος λήγει σε 7 ημέρες.`,
    }),
    ru: (d) => ({
      subject: `Приглашение в ${d.firmName} в Kleidi`,
      text: `${d.inviterName} приглашает вас в ${d.firmName} в роли: ${ROLE_NAMES.ru[d.role] ?? d.role}.\n\nПринять приглашение: ${d.link}\n\nСсылка действует 7 дней.`,
    }),
  },
  "deadline-reminder": {
    en: (d) => ({
      subject: `Reminder: ${d.title} (${d.caseReference}) is due ${d.due}`,
      text: `The deadline "${d.title}" on case ${d.caseReference} is due ${d.due}.\n\nOpen the case: ${d.link}`,
    }),
    el: (d) => ({
      subject: `Υπενθύμιση: ${d.title} (${d.caseReference}) λήγει ${d.due}`,
      text: `Η προθεσμία «${d.title}» της υπόθεσης ${d.caseReference} λήγει ${d.due}.\n\nΆνοιγμα υπόθεσης: ${d.link}`,
    }),
    ru: (d) => ({
      subject: `Напоминание: срок «${d.title}» (${d.caseReference}) истекает ${d.due}`,
      text: `Срок «${d.title}» по делу ${d.caseReference} истекает ${d.due}.\n\nОткрыть дело: ${d.link}`,
    }),
  },
  // SMS: one short line, no link, so it fits in a single message.
  "deadline-reminder-sms": {
    en: (d) => ({ subject: "", text: `Kleidi: ${d.title} (${d.caseReference}) is due ${d.due}.` }),
    el: (d) => ({ subject: "", text: `Kleidi: ${d.title} (${d.caseReference}) λήγει ${d.due}.` }),
    ru: (d) => ({ subject: "", text: `Kleidi: ${d.title} (${d.caseReference}), срок ${d.due}.` }),
  },
  "document-expiring": {
    en: (d) => ({
      subject:
        d.state === "expired"
          ? `Expired: ${d.title} (${d.caseReference})`
          : `Expires soon: ${d.title} (${d.caseReference})`,
      text: `${d.state === "expired" ? `The document "${d.title}" on case ${d.caseReference} expired on ${d.date}.` : `The document "${d.title}" on case ${d.caseReference} expires on ${d.date}.`} Upload a fresh copy before it holds up the sale.\n\nOpen the case: ${d.link}`,
    }),
    el: (d) => ({
      subject:
        d.state === "expired"
          ? `Έληξε: ${d.title} (${d.caseReference})`
          : `Λήγει σύντομα: ${d.title} (${d.caseReference})`,
      text: `${d.state === "expired" ? `Το έγγραφο «${d.title}» της υπόθεσης ${d.caseReference} έληξε στις ${d.date}.` : `Το έγγραφο «${d.title}» της υπόθεσης ${d.caseReference} λήγει στις ${d.date}.`} Μεταφορτώστε νέο αντίγραφο πριν καθυστερήσει την πώληση.\n\nΆνοιγμα υπόθεσης: ${d.link}`,
    }),
    ru: (d) => ({
      subject:
        d.state === "expired"
          ? `Истёк: ${d.title} (${d.caseReference})`
          : `Скоро истекает: ${d.title} (${d.caseReference})`,
      text: `${d.state === "expired" ? `Срок документа «${d.title}» по делу ${d.caseReference} истёк ${d.date}.` : `Срок документа «${d.title}» по делу ${d.caseReference} истекает ${d.date}.`} Загрузите новую копию, чтобы не задерживать сделку.\n\nОткрыть дело: ${d.link}`,
    }),
  },
  "daily-digest": {
    en: (d) => ({
      subject: `Your Kleidi day: ${d.overdue.length + d.upcoming.length} deadlines, ${d.documents.length} documents to check`,
      text: `Good morning ${d.name},\n\n${sections([
        ["Overdue", d.overdue],
        ["Due in the next 7 days", d.upcoming],
        ["Documents that need attention", d.documents],
        [
          "Gaps left in earlier stages",
          d.gaps.map((g) => ({
            caseReference: g.caseReference,
            title: `${g.count} unfinished checklist items in earlier stages`,
            when: "",
          })),
        ],
      ])}\n\nOpen Kleidi: ${d.link}`,
    }),
    el: (d) => ({
      subject: `Η ημέρα σας στο Kleidi: ${d.overdue.length + d.upcoming.length} προθεσμίες, ${d.documents.length} έγγραφα για έλεγχο`,
      text: `Καλημέρα ${d.name},\n\n${sections([
        ["Εκπρόθεσμες", d.overdue],
        ["Λήγουν τις επόμενες 7 ημέρες", d.upcoming],
        ["Έγγραφα που χρειάζονται προσοχή", d.documents],
        [
          "Κενά σε προηγούμενα στάδια",
          d.gaps.map((g) => ({
            caseReference: g.caseReference,
            title: `${g.count} εκκρεμή στοιχεία σε προηγούμενα στάδια`,
            when: "",
          })),
        ],
      ])}\n\nΆνοιγμα Kleidi: ${d.link}`,
    }),
    ru: (d) => ({
      subject: `Ваш день в Kleidi: сроков ${d.overdue.length + d.upcoming.length}, документов на проверку ${d.documents.length}`,
      text: `Доброе утро, ${d.name}!\n\n${sections([
        ["Просрочено", d.overdue],
        ["Сроки в ближайшие 7 дней", d.upcoming],
        ["Документы, требующие внимания", d.documents],
        [
          "Пробелы в прошлых этапах",
          d.gaps.map((g) => ({
            caseReference: g.caseReference,
            title: `незавершённых пунктов в прошлых этапах: ${g.count}`,
            when: "",
          })),
        ],
      ])}\n\nОткрыть Kleidi: ${d.link}`,
    }),
  },
};

export function render<K extends TemplateName>(
  template: K,
  locale: Locale,
  data: TemplateData[K],
): Rendered {
  return TEMPLATES[template][locale](data);
}

export const LOCALES: Locale[] = ["en", "el", "ru"];
export const asLocale = (value: string | null | undefined): Locale =>
  (LOCALES as string[]).includes(value ?? "") ? (value as Locale) : "en";

/** Dates and times in Cyprus time, written the way each language expects. */
export function formatWhen(date: Date, locale: Locale, withTime = true): string {
  return date.toLocaleString(locale === "el" ? "el-GR" : locale === "ru" ? "ru-RU" : "en-GB", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Asia/Nicosia",
  });
}
