import type { Localised } from "../schema/columns.ts";

// Plain-English guidance the client portal shows for the case's current stage.
// English only for now: Greek and Russian fall back to it until they are translated.
export type StageGuide = { clientNow: Localised; clientAction: Localised };
const g = (now: string, action: string): StageGuide => ({
  clientNow: { en: now },
  clientAction: { en: action },
});

export const STAGE_GUIDES: Record<string, Record<string, StageGuide>> = {
  CY: {
    reservation: g(
      "You have reserved the property, usually with a deposit. Your lawyer is collecting the papers they need to check it.",
      "Send your lawyer your passport and proof of address, and tell them how you will pay for the property.",
    ),
    due_diligence: g(
      "Your lawyer is checking the property at the Land Registry: who owns it, whether a title deed exists, and whether anything such as a mortgage or court judgment is registered against it.",
      "Nothing yet. If your lawyer shares a search result, you can ask for it to be explained in English.",
    ),
    contract_signed: g(
      "The sale contract has been agreed and signed. It sets the price, the payment schedule and what happens if either side does not keep to it.",
      "Make sure you have a copy of the signed contract, and check the payment schedule below.",
    ),
    contract_deposited: g(
      "Your lawyer has deposited the contract at the Land Registry. This protects your right to the property against later sales or charges.",
      "Nothing. Keep the deposit receipt with your papers.",
    ),
    payments: g(
      "You are paying the price in the instalments set by the contract.",
      "Pay each instalment by its due date, to the account in the contract, and tell your lawyer when you have paid.",
    ),
    final_approval: g(
      "The building is waiting for its certificate of final approval from the authorities. Separate title deeds can only be issued after it.",
      "Nothing. This step can take months, and your lawyer will tell you when it moves.",
    ),
    title_transfer: g(
      "The title deed is being transferred into your name at the Land Registry, and transfer fees are being paid.",
      "Pay the transfer fees when your lawyer asks, and be ready to sign the transfer or give a power of attorney.",
    ),
    completed: g(
      "The sale is complete and the property is registered in your name.",
      "Keep your title deed and the completion papers safe.",
    ),
  },
  EW: {
    instruction: g(
      "You have instructed your conveyancer. They are opening your file and checking your identity, as the law requires.",
      "Sign and return the client care letter, send your ID, and show where your deposit is coming from.",
    ),
    pre_contract: g(
      "Your conveyancer has the draft contract and is ordering searches on the property: local authority, drainage and environmental.",
      "Nothing yet. Searches usually take two to six weeks.",
    ),
    enquiries: g(
      "Your conveyancer is raising questions with the seller's solicitor and checking your mortgage offer. They will then send you a report on the property.",
      "Read the report on title when it arrives, and ask about anything you do not understand.",
    ),
    mortgage: g(
      "Your lender's offer is being checked against the property and the contract.",
      "Tell your conveyancer if anything in your mortgage offer is different from what you expected.",
    ),
    exchange: g(
      "Contracts are being exchanged. After exchange the sale is legally binding and the completion date is fixed.",
      "Sign the contract and transfer, pay your deposit, and arrange buildings insurance from the exchange date.",
    ),
    completion: g(
      "On completion day the money moves to the seller and you can collect the keys.",
      "Make sure the balance of the price is with your conveyancer before completion day.",
    ),
    post_completion: g(
      "Your conveyancer is paying the stamp duty or Land Transaction Tax and registering you as the owner at HM Land Registry.",
      "Nothing. Registration can take a few weeks.",
    ),
    completed: g(
      "The purchase is complete and you are registered as the owner.",
      "Keep your completion papers safe.",
    ),
  },
};
