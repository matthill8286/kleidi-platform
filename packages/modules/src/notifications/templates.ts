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
  "portal-invitation": {
    firmName: string;
    lawyerName: string;
    caseReference: string;
    link: string;
  };
  "portal-sign-in": { firmName: string; link: string };
  "verify-email": { name: string; link: string };
  "reset-password": { name: string; link: string };
  "portal-code": { code: string };
  "portal-message": { firmName: string; authorName: string; caseReference: string; link: string };
  "portal-message-sms": { firmName: string; caseReference: string };
  "client-message": { clientName: string; caseReference: string; link: string };
  "client-message-sms": { clientName: string; caseReference: string };
  "portal-payment-added": {
    firmName: string;
    caseReference: string;
    label: string;
    amount: string;
    // Empty when the instalment has no date yet.
    due: string;
    link: string;
  };
  "portal-payment-due": {
    firmName: string;
    caseReference: string;
    label: string;
    amount: string;
    due: string;
    when: "week" | "today";
    payTo: string;
    link: string;
  };
  "portal-payment-due-sms": {
    caseReference: string;
    label: string;
    amount: string;
    due: string;
    when: "week" | "today";
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
  // Message alerts never carry the message itself: the client reads it after signing in.
  "portal-message": {
    en: (d) => ({
      subject: `New message from ${d.authorName} about ${d.caseReference}`,
      text: `${d.authorName} at ${d.firmName} has sent you a message about your case ${d.caseReference}.\n\nRead it in your case: ${d.link}\n\nIf you are not signed in, enter your email there and we will send you a link.`,
    }),
    el: (d) => ({
      subject: `Νέο μήνυμα από ${d.authorName} για ${d.caseReference}`,
      text: `${d.authorName} από ${d.firmName} σας έστειλε μήνυμα για την υπόθεσή σας ${d.caseReference}.\n\nΔιαβάστε το στην υπόθεσή σας: ${d.link}\n\nΑν δεν είστε συνδεδεμένοι, γράψτε εκεί το email σας και θα σας στείλουμε σύνδεσμο.`,
    }),
    ru: (d) => ({
      subject: `Новое сообщение от ${d.authorName} по делу ${d.caseReference}`,
      text: `${d.authorName} (${d.firmName}) отправил(а) вам сообщение по делу ${d.caseReference}.\n\nПрочитать в кабинете: ${d.link}\n\nЕсли вы не вошли, укажите там свой email, и мы пришлём ссылку.`,
    }),
  },
  "portal-message-sms": {
    en: (d) => ({
      subject: "",
      text: `Kleidi: ${d.firmName} sent you a message about ${d.caseReference}. Check your email for the link.`,
    }),
    el: (d) => ({
      subject: "",
      text: `Kleidi: Νέο μήνυμα από ${d.firmName} για ${d.caseReference}. Δείτε το email σας.`,
    }),
    ru: (d) => ({
      subject: "",
      text: `Kleidi: новое сообщение от ${d.firmName} по делу ${d.caseReference}. Ссылка в email.`,
    }),
  },
  "client-message": {
    en: (d) => ({
      subject: `${d.clientName} sent a message about ${d.caseReference}`,
      text: `${d.clientName} has sent a message on case ${d.caseReference}.\n\nOpen the case to read and reply: ${d.link}`,
    }),
    el: (d) => ({
      subject: `${d.clientName} έστειλε μήνυμα για ${d.caseReference}`,
      text: `${d.clientName} έστειλε μήνυμα στην υπόθεση ${d.caseReference}.\n\nΆνοιγμα υπόθεσης για ανάγνωση και απάντηση: ${d.link}`,
    }),
    ru: (d) => ({
      subject: `${d.clientName} отправил(а) сообщение по делу ${d.caseReference}`,
      text: `${d.clientName} отправил(а) сообщение по делу ${d.caseReference}.\n\nОткрыть дело, чтобы прочитать и ответить: ${d.link}`,
    }),
  },
  "client-message-sms": {
    en: (d) => ({
      subject: "",
      text: `Kleidi: ${d.clientName} sent a message on ${d.caseReference}.`,
    }),
    el: (d) => ({
      subject: "",
      text: `Kleidi: ${d.clientName} έστειλε μήνυμα για ${d.caseReference}.`,
    }),
    ru: (d) => ({
      subject: "",
      text: `Kleidi: ${d.clientName} написал(а) по делу ${d.caseReference}.`,
    }),
  },
  "portal-payment-added": {
    en: (d) => ({
      subject: `New payment on your schedule: ${d.label}`,
      text: `${d.firmName} has added a payment to the schedule for your case ${d.caseReference}.\n\n${d.label}: ${d.amount}${d.due ? `, due ${d.due}` : ""}\n\nSee the full schedule: ${d.link}`,
    }),
    el: (d) => ({
      subject: `Νέα πληρωμή στο πρόγραμμά σας: ${d.label}`,
      text: `${d.firmName} πρόσθεσε μια πληρωμή στο πρόγραμμα της υπόθεσής σας ${d.caseReference}.\n\n${d.label}: ${d.amount}${d.due ? `, λήγει ${d.due}` : ""}\n\nΔείτε όλο το πρόγραμμα: ${d.link}`,
    }),
    ru: (d) => ({
      subject: `Новый платёж в графике: ${d.label}`,
      text: `${d.firmName} добавил(а) платёж в график по вашему делу ${d.caseReference}.\n\n${d.label}: ${d.amount}${d.due ? `, срок ${d.due}` : ""}\n\nВесь график: ${d.link}`,
    }),
  },
  "portal-payment-due": {
    en: (d) => ({
      subject:
        d.when === "today" ? `Payment due today: ${d.label}` : `Payment due in a week: ${d.label}`,
      text: `${d.label} of ${d.amount} on your case ${d.caseReference} is due ${d.when === "today" ? "today" : `on ${d.due}`}.${d.payTo ? `\n\nPay to: ${d.payTo}` : ""}\n\nPlease tell ${d.firmName} once you have paid.\n\nYour schedule: ${d.link}`,
    }),
    el: (d) => ({
      subject:
        d.when === "today" ? `Πληρωμή σήμερα: ${d.label}` : `Πληρωμή σε μία εβδομάδα: ${d.label}`,
      text: `${d.label} ύψους ${d.amount} για την υπόθεσή σας ${d.caseReference} λήγει ${d.when === "today" ? "σήμερα" : `στις ${d.due}`}.${d.payTo ? `\n\nΠληρωμή σε: ${d.payTo}` : ""}\n\nΕνημερώστε το ${d.firmName} όταν πληρώσετε.\n\nΤο πρόγραμμά σας: ${d.link}`,
    }),
    ru: (d) => ({
      subject:
        d.when === "today" ? `Платёж сегодня: ${d.label}` : `Платёж через неделю: ${d.label}`,
      text: `${d.label} на сумму ${d.amount} по делу ${d.caseReference} нужно оплатить ${d.when === "today" ? "сегодня" : d.due}.${d.payTo ? `\n\nПолучатель: ${d.payTo}` : ""}\n\nСообщите ${d.firmName}, когда оплатите.\n\nВаш график: ${d.link}`,
    }),
  },
  "portal-payment-due-sms": {
    en: (d) => ({
      subject: "",
      text: `Kleidi: ${d.label} (${d.amount}) for ${d.caseReference} is due ${d.when === "today" ? "today" : d.due}.`,
    }),
    el: (d) => ({
      subject: "",
      text: `Kleidi: ${d.label} (${d.amount}) για ${d.caseReference} λήγει ${d.when === "today" ? "σήμερα" : d.due}.`,
    }),
    ru: (d) => ({
      subject: "",
      text: `Kleidi: ${d.label} (${d.amount}) по ${d.caseReference}, срок ${d.when === "today" ? "сегодня" : d.due}.`,
    }),
  },
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
  "portal-invitation": {
    en: (d) => ({
      subject: `Follow your property purchase with ${d.firmName}`,
      text: `${d.lawyerName} at ${d.firmName} has set up Kleidi for your case ${d.caseReference}. You can follow each step, see documents your lawyer shares and send documents securely.\n\nOpen your case: ${d.link}\n\nWe will text a code to your phone to confirm it is you. The link works for 7 days.`,
    }),
    el: (d) => ({
      subject: `Παρακολουθήστε την αγορά του ακινήτου σας με ${d.firmName}`,
      text: `${d.lawyerName} από ${d.firmName} ενεργοποίησε το Kleidi για την υπόθεσή σας ${d.caseReference}. Μπορείτε να παρακολουθείτε κάθε βήμα, να βλέπετε έγγραφα που μοιράζεται ο δικηγόρος σας και να στέλνετε έγγραφα με ασφάλεια.\n\nΆνοιγμα υπόθεσης: ${d.link}\n\nΘα στείλουμε έναν κωδικό στο κινητό σας για επιβεβαίωση. Ο σύνδεσμος ισχύει 7 ημέρες.`,
    }),
    ru: (d) => ({
      subject: `Следите за покупкой недвижимости с ${d.firmName}`,
      text: `${d.lawyerName} из ${d.firmName} подключил(а) Kleidi для вашего дела ${d.caseReference}. Вы сможете следить за каждым этапом, видеть документы от юриста и безопасно отправлять документы.\n\nОткрыть дело: ${d.link}\n\nМы отправим код на ваш телефон для подтверждения. Ссылка действует 7 дней.`,
    }),
  },
  "portal-sign-in": {
    en: (d) => ({
      subject: `Your sign-in link for ${d.firmName}`,
      text: `Open your case: ${d.link}\n\nThe link works for 30 minutes. If you did not ask for it, you can ignore this email.`,
    }),
    el: (d) => ({
      subject: `Ο σύνδεσμος σύνδεσης για ${d.firmName}`,
      text: `Άνοιγμα υπόθεσης: ${d.link}\n\nΟ σύνδεσμος ισχύει 30 λεπτά. Αν δεν τον ζητήσατε, αγνοήστε αυτό το email.`,
    }),
    ru: (d) => ({
      subject: `Ссылка для входа: ${d.firmName}`,
      text: `Открыть дело: ${d.link}\n\nСсылка действует 30 минут. Если вы её не запрашивали, просто проигнорируйте письмо.`,
    }),
  },
  "verify-email": {
    en: (d) => ({
      subject: "Confirm your email for Kleidi",
      text: `Hello ${d.name},\n\nConfirm your email address to finish setting up your Kleidi account: ${d.link}\n\nIf you did not sign up, you can ignore this email.`,
    }),
    el: (d) => ({
      subject: "Επιβεβαιώστε το email σας για το Kleidi",
      text: `Γεια σας ${d.name},\n\nΕπιβεβαιώστε τη διεύθυνση email σας για να ολοκληρώσετε τον λογαριασμό σας στο Kleidi: ${d.link}\n\nΑν δεν κάνατε εγγραφή, αγνοήστε αυτό το email.`,
    }),
    ru: (d) => ({
      subject: "Подтвердите email для Kleidi",
      text: `Здравствуйте, ${d.name}!\n\nПодтвердите адрес email, чтобы завершить настройку аккаунта Kleidi: ${d.link}\n\nЕсли вы не регистрировались, просто проигнорируйте письмо.`,
    }),
  },
  "reset-password": {
    en: (d) => ({
      subject: "Reset your Kleidi password",
      text: `Hello ${d.name},\n\nChoose a new password for your Kleidi account: ${d.link}\n\nThe link works once, for 1 hour. If you did not ask to reset your password, you can ignore this email and your password stays the same.`,
    }),
    el: (d) => ({
      subject: "Επαναφορά κωδικού πρόσβασης Kleidi",
      text: `Γεια σας ${d.name},\n\nΕπιλέξτε νέο κωδικό πρόσβασης για τον λογαριασμό σας στο Kleidi: ${d.link}\n\nΟ σύνδεσμος λειτουργεί μία φορά, για 1 ώρα. Αν δεν ζητήσατε επαναφορά κωδικού, αγνοήστε αυτό το email και ο κωδικός σας παραμένει ίδιος.`,
    }),
    ru: (d) => ({
      subject: "Сброс пароля Kleidi",
      text: `Здравствуйте, ${d.name}!\n\nЗадайте новый пароль для аккаунта Kleidi: ${d.link}\n\nСсылка действует один раз в течение 1 часа. Если вы не запрашивали сброс пароля, просто проигнорируйте письмо, и пароль останется прежним.`,
    }),
  },
  "portal-code": {
    en: (d) => ({ subject: "", text: `Your Kleidi code is ${d.code}. It expires in 10 minutes.` }),
    el: (d) => ({ subject: "", text: `Ο κωδικός σας Kleidi είναι ${d.code}. Λήγει σε 10 λεπτά.` }),
    ru: (d) => ({ subject: "", text: `Ваш код Kleidi: ${d.code}. Действует 10 минут.` }),
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

/** Why a document is in the digest, in each language. */
export const DOCUMENT_STATES: Record<
  Locale,
  Record<"expiring" | "expired" | "infected" | "review" | "rejected", string>
> = {
  en: {
    expiring: "expires",
    expired: "expired",
    infected: "failed the virus scan",
    review: "waiting for your review",
    rejected: "rejected, new version needed",
  },
  el: {
    expiring: "λήγει",
    expired: "έληξε",
    infected: "απέτυχε στον έλεγχο ιών",
    review: "αναμένει τον έλεγχό σας",
    rejected: "απορρίφθηκε, χρειάζεται νέα έκδοση",
  },
  ru: {
    expiring: "истекает",
    expired: "истёк",
    infected: "не прошёл проверку на вирусы",
    review: "ждёт вашей проверки",
    rejected: "отклонён, нужна новая версия",
  },
};

/** An amount in minor units (cents, pence) in the reader's language, such as €30,000.00. */
export function formatMoney(minor: number, currency: string, locale: Locale): string {
  const tag = locale === "el" ? "el-GR" : locale === "ru" ? "ru-RU" : "en-GB";
  return new Intl.NumberFormat(tag, { style: "currency", currency }).format(minor / 100);
}
