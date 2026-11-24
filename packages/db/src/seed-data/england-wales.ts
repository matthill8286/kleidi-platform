import type { Localised } from "../schema/columns.ts";

// Residential conveyancing in England and Wales. English only: other languages fall back to it.
// Leasehold-only documents (TA7, management pack) wait until requirements can depend on tenure.
const en = (text: string): Localised => ({ en: text });

export const ENGLAND_WALES_STAGES: { key: string; label: Localised }[] = [
  { key: "instruction", label: en("Instruction and ID") },
  { key: "pre_contract", label: en("Contract pack and searches") },
  { key: "enquiries", label: en("Enquiries and report on title") },
  { key: "mortgage", label: en("Mortgage offer") },
  { key: "exchange", label: en("Exchange of contracts") },
  { key: "completion", label: en("Completion") },
  { key: "post_completion", label: en("Tax return and registration") },
  { key: "completed", label: en("Completed") },
];

export const ENGLAND_WALES_REQUIREMENTS: {
  key: string;
  stageKey: string;
  expiryDays?: number;
  label: Localised;
  help: Localised;
}[] = [
  {
    key: "client_care_letter",
    stageKey: "instruction",
    label: en("Signed client care letter"),
    help: en("Terms of engagement and the fee estimate, signed by the client."),
  },
  {
    key: "id_verification",
    stageKey: "instruction",
    label: en("Identity verification"),
    help: en("Photo ID and proof of address for each client, checked under the firm's AML policy."),
  },
  {
    key: "source_of_funds",
    stageKey: "instruction",
    label: en("Source of funds"),
    help: en("Bank statements or other evidence for the deposit and any gifted money."),
  },
  {
    key: "draft_contract",
    stageKey: "pre_contract",
    label: en("Draft contract"),
    help: en("The seller's draft contract, usually on the Standard Conditions of Sale."),
  },
  {
    key: "title_register",
    stageKey: "pre_contract",
    label: en("Official copy of the title register"),
    help: en("From HM Land Registry. Shows the owner, charges and restrictions."),
  },
  {
    key: "title_plan",
    stageKey: "pre_contract",
    label: en("Title plan"),
    help: en("The Land Registry plan showing the extent of the property."),
  },
  {
    key: "property_information_form",
    stageKey: "pre_contract",
    label: en("Property information form (TA6)"),
    help: en("The seller's answers on boundaries, disputes, alterations and services."),
  },
  {
    key: "fittings_contents_form",
    stageKey: "pre_contract",
    label: en("Fittings and contents form (TA10)"),
    help: en("What is included in the sale and what the seller will remove."),
  },
  {
    key: "local_search",
    stageKey: "pre_contract",
    expiryDays: 180,
    label: en("Local authority search"),
    help: en("Planning history, road schemes and notices from the local council."),
  },
  {
    key: "drainage_water_search",
    stageKey: "pre_contract",
    expiryDays: 180,
    label: en("Drainage and water search"),
    help: en("Whether the property is connected to the public sewer and water supply."),
  },
  {
    key: "environmental_search",
    stageKey: "pre_contract",
    expiryDays: 180,
    label: en("Environmental search"),
    help: en("Flood risk, contaminated land and ground stability."),
  },
  {
    key: "replies_to_enquiries",
    stageKey: "enquiries",
    label: en("Replies to enquiries"),
    help: en("The seller's solicitor's answers to every enquiry raised."),
  },
  {
    key: "report_on_title",
    stageKey: "enquiries",
    label: en("Report on title"),
    help: en("Your report to the buyer on the title, searches and contract, signed off by them."),
  },
  {
    key: "mortgage_offer",
    stageKey: "mortgage",
    expiryDays: 180,
    label: en("Mortgage offer"),
    help: en("The lender's formal offer, with any special conditions checked."),
  },
  {
    key: "signed_contract",
    stageKey: "exchange",
    label: en("Signed contract"),
    help: en("The buyer's signed part of the contract, ready to exchange."),
  },
  {
    key: "signed_transfer",
    stageKey: "exchange",
    label: en("Signed transfer deed (TR1)"),
    help: en("The transfer, signed and witnessed, held until completion."),
  },
  {
    key: "deposit_received",
    stageKey: "exchange",
    label: en("Deposit received"),
    help: en("Cleared funds for the deposit in the client account before exchange."),
  },
  {
    key: "completion_statement",
    stageKey: "completion",
    label: en("Completion statement"),
    help: en("The final figures: price, deposit, mortgage advance, fees and stamp duty."),
  },
  {
    key: "completion_funds",
    stageKey: "completion",
    label: en("Completion funds"),
    help: en("The mortgage advance and the balance from the buyer, received in full."),
  },
  {
    key: "transaction_tax_return",
    stageKey: "post_completion",
    label: en("Stamp duty or Land Transaction Tax return"),
    help: en(
      "In England, the SDLT5 certificate from HMRC. In Wales, the Welsh Revenue Authority's receipt for Land Transaction Tax.",
    ),
  },
  {
    key: "land_registry_application",
    stageKey: "post_completion",
    label: en("Land Registry application (AP1)"),
    help: en("The application to register the buyer and the lender's charge."),
  },
  {
    key: "registration_completion",
    stageKey: "post_completion",
    label: en("Completion of registration"),
    help: en("The updated title register showing the buyer as owner."),
  },
];
