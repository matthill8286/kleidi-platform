import type { Localised } from "../schema/columns.ts";
import { CYPRUS_REQUIREMENTS, CYPRUS_STAGES } from "./cyprus.ts";
import { ENGLAND_WALES_REQUIREMENTS, ENGLAND_WALES_STAGES } from "./england-wales.ts";
import { STAGE_GUIDES } from "./guides.ts";

export type JurisdictionSeed = {
  code: string;
  name: string;
  defaultLocale: string;
  timezone: string;
  phoneExample: string;
  asksTenure: boolean;
  currency: string;
  stages: { key: string; label: Localised; clientNow?: Localised; clientAction?: Localised }[];
  requirements: {
    key: string;
    stageKey: string;
    expiryDays?: number;
    label: Localised;
    help: Localised;
  }[];
};

/** Every jurisdiction Kleidi covers. A new country is a new entry here, not new code. */
export const JURISDICTIONS: JurisdictionSeed[] = [
  {
    code: "CY",
    name: "Cyprus",
    defaultLocale: "el",
    timezone: "Asia/Nicosia",
    phoneExample: "+357 99 123456",
    asksTenure: false,
    currency: "EUR",
    stages: CYPRUS_STAGES.map((s) => ({ ...s, ...STAGE_GUIDES.CY![s.key] })),
    requirements: CYPRUS_REQUIREMENTS,
  },
  {
    code: "EW",
    name: "England and Wales",
    defaultLocale: "en",
    timezone: "Europe/London",
    phoneExample: "+44 7700 900123",
    asksTenure: true,
    currency: "GBP",
    stages: ENGLAND_WALES_STAGES.map((s) => ({ ...s, ...STAGE_GUIDES.EW![s.key] })),
    requirements: ENGLAND_WALES_REQUIREMENTS,
  },
];
