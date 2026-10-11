import type { Localised } from "../schema/columns.ts";

// Russian strings are drafts and need professional translation before launch.
export const CYPRUS_STAGES: { key: string; label: Localised }[] = [
  { key: "reservation", label: { en: "Reservation", el: "Κράτηση", ru: "Бронирование" } },
  {
    key: "due_diligence",
    label: { en: "Due diligence", el: "Νομικός έλεγχος", ru: "Юридическая проверка" },
  },
  {
    key: "contract_signed",
    label: { en: "Contract signed", el: "Υπογραφή συμβολαίου", ru: "Подписание договора" },
  },
  {
    key: "contract_deposited",
    label: {
      en: "Contract deposited at Land Registry",
      el: "Κατάθεση συμβολαίου στο Κτηματολόγιο",
      ru: "Договор депонирован в Земельном кадастре",
    },
  },
  { key: "payments", label: { en: "Payments", el: "Πληρωμές", ru: "Платежи" } },
  {
    key: "final_approval",
    label: {
      en: "Certificate of final approval",
      el: "Πιστοποιητικό τελικής έγκρισης",
      ru: "Сертификат окончательного одобрения",
    },
  },
  {
    key: "title_transfer",
    label: { en: "Title deed transfer", el: "Μεταβίβαση τίτλου", ru: "Передача титула" },
  },
  { key: "completed", label: { en: "Completed", el: "Ολοκληρώθηκε", ru: "Завершено" } },
];

// Carried over from the prototype checklist; expiryDays marks searches that go stale.
export const CYPRUS_REQUIREMENTS: {
  key: string;
  stageKey: string;
  expiryDays?: number;
  label: Localised;
  help: Localised;
}[] = [
  {
    key: "title_deed",
    stageKey: "due_diligence",
    label: {
      en: "Title deed status",
      el: "Κατάσταση τίτλου ιδιοκτησίας",
      ru: "Статус титула собственности",
    },
    help: {
      en: "Issued, pending at Land Registry, or trapped with the developer.",
      el: "Εκδοθείς, σε εκκρεμότητα στο Κτηματολόγιο, ή δεσμευμένος στον εργολάβο.",
      ru: "Выдан, на рассмотрении в Земельном кадастре или заблокирован у застройщика.",
    },
  },
  {
    key: "planning_zone",
    stageKey: "due_diligence",
    label: { en: "Planning / zoning", el: "Πολεοδομική ζώνη", ru: "Градостроительное зонирование" },
    help: {
      en: "Confirm the plot can legally be used as sold (residential vs agricultural).",
      el: "Επιβεβαιώστε ότι το τεμάχιο μπορεί νόμιμα να χρησιμοποιηθεί ως πωλείται.",
      ru: "Убедитесь, что участок можно законно использовать так, как он продаётся.",
    },
  },
  {
    key: "encumbrances",
    stageKey: "due_diligence",
    expiryDays: 30,
    label: {
      en: "Charges and encumbrances",
      el: "Βάρη και δεσμεύσεις",
      ru: "Обременения и залоги",
    },
    help: {
      en: "Mortgages, memos, court charges on the specific registration.",
      el: "Υποθήκες, memos, δικαστικά βάρη στο συγκεκριμένο ακίνητο.",
      ru: "Ипотеки, мемо и судебные обременения на конкретную регистрацию.",
    },
  },
  {
    key: "developer",
    stageKey: "due_diligence",
    expiryDays: 90,
    label: {
      en: "Developer / seller identity",
      el: "Ταυτότητα εργολάβου / πωλητή",
      ru: "Личность застройщика / продавца",
    },
    help: {
      en: "Company search, previous trapped-buyer pattern, guarantees.",
      el: "Έρευνα εταιρείας, ιστορικό εγκλωβισμένων αγοραστών, εγγυήσεις.",
      ru: "Проверка компании, история заблокированных покупателей, гарантии.",
    },
  },
  {
    key: "contract",
    stageKey: "contract_signed",
    label: { en: "Sale contract", el: "Συμβόλαιο πώλησης", ru: "Договор купли-продажи" },
    help: {
      en: "Bilingual or certified translation. Payment schedule if off-plan.",
      el: "Δίγλωσσο ή επίσημη μετάφραση. Χρονοδιάγραμμα πληρωμών αν είναι off-plan.",
      ru: "Двуязычный или с заверенным переводом. График платежей, если объект строится.",
    },
  },
  {
    key: "deposited_contract",
    stageKey: "contract_deposited",
    label: {
      en: "Contract deposited at Land Registry",
      el: "Κατάθεση συμβολαίου στο Κτηματολόγιο",
      ru: "Депонирование договора в Земельном кадастре",
    },
    help: {
      en: "Specific performance protection. If this slips, the seller can sell twice.",
      el: "Προστασία ειδικής εκτέλεσης. Αν καθυστερήσει, ο πωλητής μπορεί να πουλήσει δύο φορές.",
      ru: "Защита права на исполнение в натуре. При задержке продавец может продать объект дважды.",
    },
  },
  {
    key: "funds",
    stageKey: "payments",
    label: {
      en: "Where the money sits",
      el: "Πού βρίσκονται τα χρήματα",
      ru: "Где находятся деньги",
    },
    help: {
      en: "Lawyer client account vs developer account vs escrow. Do not send the next tranche until this is clear.",
      el: "Λογαριασμός δικηγόρου vs εργολάβου vs μεσεγγύηση. Μην στείλετε την επόμενη δόση αν αυτό δεν είναι σαφές.",
      ru: "Клиентский счёт юриста, счёт застройщика или эскроу. Не переводите следующий платёж, пока это не ясно.",
    },
  },
  {
    key: "utilities",
    stageKey: "title_transfer",
    label: {
      en: "Utilities and common expenses",
      el: "Κοινόχρηστα και υπηρεσίες",
      ru: "Коммунальные услуги и общие расходы",
    },
    help: {
      en: "EAC, water, management committee arrears.",
      el: "ΑΗΚ, νερό, οφειλές διαχειριστικής επιτροπής.",
      ru: "Электричество (EAC), вода, долги перед управляющим комитетом.",
    },
  },
];
