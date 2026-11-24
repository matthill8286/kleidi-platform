import type { Localised } from "../schema/columns.ts";
import { CYPRUS_REQUIREMENTS, CYPRUS_STAGES } from "./cyprus.ts";
import { ENGLAND_WALES_REQUIREMENTS, ENGLAND_WALES_STAGES } from "./england-wales.ts";

export type JurisdictionSeed = {
  code: string;
  name: string;
  defaultLocale: string;
  timezone: string;
  phoneExample: string;
  asksTenure: boolean;
  stages: { key: string; label: Localised }[];
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
    stages: CYPRUS_STAGES,
    requirements: CYPRUS_REQUIREMENTS,
  },
  {
    code: "EW",
    name: "England and Wales",
    defaultLocale: "en",
    timezone: "Europe/London",
    phoneExample: "+44 7700 900123",
    asksTenure: true,
    stages: ENGLAND_WALES_STAGES,
    requirements: ENGLAND_WALES_REQUIREMENTS,
  },
];
