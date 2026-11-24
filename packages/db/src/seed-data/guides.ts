import type { Localised } from "../schema/columns.ts";

// Plain-language guidance the client portal shows for the case's current stage.
// Greek and Russian are drafts pending professional translation, like the rest of the copy.
export type StageGuide = { clientNow: Localised; clientAction: Localised };
type Text = [en: string, el: string, ru: string];
const t = ([en, el, ru]: Text): Localised => ({ en, el, ru });
const g = (now: Text, action: Text): StageGuide => ({ clientNow: t(now), clientAction: t(action) });

export const STAGE_GUIDES: Record<string, Record<string, StageGuide>> = {
  CY: {
    reservation: g(
      [
        "You have reserved the property, usually with a deposit. Your lawyer is collecting the papers they need to check it.",
        "Έχετε κάνει κράτηση του ακινήτου, συνήθως με προκαταβολή. Ο δικηγόρος σας συγκεντρώνει τα έγγραφα που χρειάζεται για να το ελέγξει.",
        "Вы забронировали недвижимость, обычно с задатком. Ваш юрист собирает документы, необходимые для её проверки.",
      ],
      [
        "Send your lawyer your passport and proof of address, and tell them how you will pay for the property.",
        "Στείλτε στον δικηγόρο σας το διαβατήριό σας και αποδεικτικό διεύθυνσης, και πείτε του πώς θα πληρώσετε το ακίνητο.",
        "Отправьте юристу паспорт и подтверждение адреса и сообщите, как вы будете оплачивать покупку.",
      ],
    ),
    due_diligence: g(
      [
        "Your lawyer is checking the property at the Land Registry: who owns it, whether a title deed exists, and whether anything such as a mortgage or court judgment is registered against it.",
        "Ο δικηγόρος σας ελέγχει το ακίνητο στο Κτηματολόγιο: ποιος είναι ο ιδιοκτήτης, αν υπάρχει τίτλος ιδιοκτησίας και αν είναι εγγεγραμμένο κάποιο βάρος, όπως υποθήκη ή δικαστική απόφαση.",
        "Ваш юрист проверяет недвижимость в Земельном кадастре: кто владелец, есть ли титул собственности и не зарегистрированы ли на неё обременения, например ипотека или судебное решение.",
      ],
      [
        "Nothing yet. If your lawyer shares a search result, you can ask for it to be explained in English.",
        "Τίποτα ακόμη. Αν ο δικηγόρος σας μοιραστεί ένα αποτέλεσμα έρευνας, μπορείτε να ζητήσετε να σας εξηγηθεί στα αγγλικά.",
        "Пока ничего. Если юрист поделится результатом проверки, вы можете попросить пояснить его на английском.",
      ],
    ),
    contract_signed: g(
      [
        "The sale contract has been agreed and signed. It sets the price, the payment schedule and what happens if either side does not keep to it.",
        "Το συμβόλαιο πώλησης έχει συμφωνηθεί και υπογραφεί. Ορίζει την τιμή, το πρόγραμμα πληρωμών και τι γίνεται αν κάποια πλευρά δεν το τηρήσει.",
        "Договор купли-продажи согласован и подписан. В нём указаны цена, график платежей и последствия, если одна из сторон его не выполнит.",
      ],
      [
        "Make sure you have a copy of the signed contract, and check the payment schedule below.",
        "Βεβαιωθείτε ότι έχετε αντίγραφο του υπογεγραμμένου συμβολαίου και ελέγξτε το πρόγραμμα πληρωμών παρακάτω.",
        "Убедитесь, что у вас есть копия подписанного договора, и проверьте график платежей ниже.",
      ],
    ),
    contract_deposited: g(
      [
        "Your lawyer has deposited the contract at the Land Registry. This protects your right to the property against later sales or charges.",
        "Ο δικηγόρος σας κατέθεσε το συμβόλαιο στο Κτηματολόγιο. Αυτό προστατεύει το δικαίωμά σας στο ακίνητο από μεταγενέστερες πωλήσεις ή βάρη.",
        "Юрист депонировал договор в Земельном кадастре. Это защищает ваше право на недвижимость от последующих продаж и обременений.",
      ],
      [
        "Nothing. Keep the deposit receipt with your papers.",
        "Τίποτα. Κρατήστε την απόδειξη κατάθεσης μαζί με τα έγγραφά σας.",
        "Ничего. Храните квитанцию о депонировании вместе с документами.",
      ],
    ),
    payments: g(
      [
        "You are paying the price in the instalments set by the contract.",
        "Πληρώνετε την τιμή σε δόσεις, όπως ορίζει το συμβόλαιο.",
        "Вы оплачиваете цену частями, как указано в договоре.",
      ],
      [
        "Pay each instalment by its due date, to the account in the contract, and tell your lawyer when you have paid.",
        "Πληρώστε κάθε δόση έως την ημερομηνία λήξης της, στον λογαριασμό που αναφέρει το συμβόλαιο, και ενημερώστε τον δικηγόρο σας όταν πληρώσετε.",
        "Оплачивайте каждый платёж до срока на счёт, указанный в договоре, и сообщайте юристу, когда оплатите.",
      ],
    ),
    final_approval: g(
      [
        "The building is waiting for its certificate of final approval from the authorities. Separate title deeds can only be issued after it.",
        "Το κτίριο αναμένει το πιστοποιητικό τελικής έγκρισης από τις αρχές. Ξεχωριστοί τίτλοι ιδιοκτησίας μπορούν να εκδοθούν μόνο μετά από αυτό.",
        "Здание ожидает сертификат окончательного одобрения от властей. Отдельные титулы собственности можно выдать только после него.",
      ],
      [
        "Nothing. This step can take months, and your lawyer will tell you when it moves.",
        "Τίποτα. Αυτό το στάδιο μπορεί να διαρκέσει μήνες και ο δικηγόρος σας θα σας ενημερώσει όταν προχωρήσει.",
        "Ничего. Этот этап может занять несколько месяцев, и юрист сообщит вам, когда он сдвинется.",
      ],
    ),
    title_transfer: g(
      [
        "The title deed is being transferred into your name at the Land Registry, and transfer fees are being paid.",
        "Ο τίτλος ιδιοκτησίας μεταβιβάζεται στο όνομά σας στο Κτηματολόγιο και καταβάλλονται τα τέλη μεταβίβασης.",
        "Титул собственности переоформляется на ваше имя в Земельном кадастре, и оплачиваются сборы за передачу.",
      ],
      [
        "Pay the transfer fees when your lawyer asks, and be ready to sign the transfer or give a power of attorney.",
        "Πληρώστε τα τέλη μεταβίβασης όταν σας το ζητήσει ο δικηγόρος σας και να είστε έτοιμοι να υπογράψετε τη μεταβίβαση ή να δώσετε πληρεξούσιο.",
        "Оплатите сборы за передачу, когда юрист попросит, и будьте готовы подписать передачу или выдать доверенность.",
      ],
    ),
    completed: g(
      [
        "The sale is complete and the property is registered in your name.",
        "Η πώληση ολοκληρώθηκε και το ακίνητο είναι εγγεγραμμένο στο όνομά σας.",
        "Сделка завершена, и недвижимость зарегистрирована на ваше имя.",
      ],
      [
        "Keep your title deed and the completion papers safe.",
        "Φυλάξτε σε ασφαλές μέρος τον τίτλο ιδιοκτησίας και τα έγγραφα ολοκλήρωσης.",
        "Храните титул собственности и документы о завершении сделки в надёжном месте.",
      ],
    ),
  },
  EW: {
    instruction: g(
      [
        "You have instructed your conveyancer. They are opening your file and checking your identity, as the law requires.",
        "Έχετε αναθέσει την υπόθεση στον δικηγόρο μεταβιβάσεων. Ανοίγει τον φάκελό σας και ελέγχει την ταυτότητά σας, όπως απαιτεί ο νόμος.",
        "Вы поручили сделку своему юристу по недвижимости. Он открывает ваше дело и проверяет вашу личность, как того требует закон.",
      ],
      [
        "Sign and return the client care letter, send your ID, and show where your deposit is coming from.",
        "Υπογράψτε και επιστρέψτε την επιστολή όρων συνεργασίας, στείλτε την ταυτότητά σας και δείξτε από πού προέρχεται η προκαταβολή σας.",
        "Подпишите и верните письмо с условиями обслуживания, отправьте документ, удостоверяющий личность, и подтвердите происхождение средств на задаток.",
      ],
    ),
    pre_contract: g(
      [
        "Your conveyancer has the draft contract and is ordering searches on the property: local authority, drainage and environmental.",
        "Ο δικηγόρος σας έχει το σχέδιο συμβολαίου και παραγγέλνει έρευνες για το ακίνητο: της τοπικής αρχής, αποχέτευσης και περιβαλλοντικές.",
        "У вашего юриста есть проект договора, и он заказывает проверки недвижимости: в местных органах власти, по водоснабжению и канализации и экологическую.",
      ],
      [
        "Nothing yet. Searches usually take two to six weeks.",
        "Τίποτα ακόμη. Οι έρευνες συνήθως διαρκούν δύο έως έξι εβδομάδες.",
        "Пока ничего. Проверки обычно занимают от двух до шести недель.",
      ],
    ),
    enquiries: g(
      [
        "Your conveyancer is raising questions with the seller's solicitor and checking your mortgage offer. They will then send you a report on the property.",
        "Ο δικηγόρος σας θέτει ερωτήματα στον δικηγόρο του πωλητή και ελέγχει την προσφορά του στεγαστικού σας δανείου. Στη συνέχεια θα σας στείλει έκθεση για το ακίνητο.",
        "Ваш юрист задаёт вопросы юристу продавца и проверяет ипотечное предложение. Затем он пришлёт вам отчёт о недвижимости.",
      ],
      [
        "Read the report on title when it arrives, and ask about anything you do not understand.",
        "Διαβάστε την έκθεση για τον τίτλο όταν φτάσει και ρωτήστε για οτιδήποτε δεν καταλαβαίνετε.",
        "Прочитайте отчёт о праве собственности, когда он придёт, и спросите обо всём, что непонятно.",
      ],
    ),
    mortgage: g(
      [
        "Your lender's offer is being checked against the property and the contract.",
        "Η προσφορά του δανειστή σας ελέγχεται σε σχέση με το ακίνητο και το συμβόλαιο.",
        "Предложение вашего кредитора проверяется на соответствие недвижимости и договору.",
      ],
      [
        "Tell your conveyancer if anything in your mortgage offer is different from what you expected.",
        "Ενημερώστε τον δικηγόρο σας αν κάτι στην προσφορά δανείου διαφέρει από ό,τι περιμένατε.",
        "Сообщите юристу, если что-то в ипотечном предложении отличается от ожидаемого.",
      ],
    ),
    exchange: g(
      [
        "Contracts are being exchanged. After exchange the sale is legally binding and the completion date is fixed.",
        "Γίνεται ανταλλαγή συμβολαίων. Μετά την ανταλλαγή η πώληση είναι νομικά δεσμευτική και η ημερομηνία ολοκλήρωσης είναι οριστική.",
        "Происходит обмен договорами. После обмена сделка становится юридически обязательной, а дата завершения фиксируется.",
      ],
      [
        "Sign the contract and transfer, pay your deposit, and arrange buildings insurance from the exchange date.",
        "Υπογράψτε το συμβόλαιο και τη μεταβίβαση, πληρώστε την προκαταβολή σας και φροντίστε για ασφάλεια κτιρίου από την ημερομηνία ανταλλαγής.",
        "Подпишите договор и акт передачи, внесите задаток и оформите страхование здания с даты обмена.",
      ],
    ),
    completion: g(
      [
        "On completion day the money moves to the seller and you can collect the keys.",
        "Την ημέρα της ολοκλήρωσης τα χρήματα πηγαίνουν στον πωλητή και μπορείτε να παραλάβετε τα κλειδιά.",
        "В день завершения деньги переводятся продавцу, и вы можете забрать ключи.",
      ],
      [
        "Make sure the balance of the price is with your conveyancer before completion day.",
        "Βεβαιωθείτε ότι το υπόλοιπο της τιμής βρίσκεται στον δικηγόρο σας πριν από την ημέρα ολοκλήρωσης.",
        "Убедитесь, что остаток цены поступил вашему юристу до дня завершения.",
      ],
    ),
    post_completion: g(
      [
        "Your conveyancer is paying the stamp duty or Land Transaction Tax and registering you as the owner at HM Land Registry.",
        "Ο δικηγόρος σας πληρώνει το τέλος χαρτοσήμου ή τον Φόρο Συναλλαγών Ακινήτων και σας εγγράφει ως ιδιοκτήτη στο HM Land Registry.",
        "Ваш юрист оплачивает гербовый сбор или налог на сделки с землёй (Land Transaction Tax) и регистрирует вас как владельца в HM Land Registry.",
      ],
      [
        "Nothing. Registration can take a few weeks.",
        "Τίποτα. Η εγγραφή μπορεί να διαρκέσει μερικές εβδομάδες.",
        "Ничего. Регистрация может занять несколько недель.",
      ],
    ),
    completed: g(
      [
        "The purchase is complete and you are registered as the owner.",
        "Η αγορά ολοκληρώθηκε και είστε εγγεγραμμένοι ως ιδιοκτήτης.",
        "Покупка завершена, и вы зарегистрированы как владелец.",
      ],
      [
        "Keep your completion papers safe.",
        "Φυλάξτε σε ασφαλές μέρος τα έγγραφα ολοκλήρωσης.",
        "Храните документы о завершении сделки в надёжном месте.",
      ],
    ),
  },
};
