import { and, asc, eq } from "drizzle-orm";
import type { Db, Tx } from "@kleidi/db";
import {
  documentRequirements,
  jurisdictions,
  stageTemplates,
} from "@kleidi/db/schema/jurisdictions";

/** Every jurisdiction a firm can practise in, with its settings. */
export function listJurisdictions(db: Db | Tx) {
  return db
    .select({
      code: jurisdictions.code,
      name: jurisdictions.name,
      defaultLocale: jurisdictions.defaultLocale,
      timezone: jurisdictions.timezone,
      phoneExample: jurisdictions.phoneExample,
      asksTenure: jurisdictions.asksTenure,
    })
    .from(jurisdictions)
    .orderBy(asc(jurisdictions.code));
}

/** One jurisdiction's settings, or undefined when Kleidi does not cover it. */
export async function findJurisdiction(db: Db | Tx, code: string) {
  return (await listJurisdictions(db)).find((j) => j.code === code);
}

/** Stages and document requirements for one country, in order. Empty stages = unknown country. */
export async function getTemplate(db: Db, code: string) {
  const stages = await db
    .select({ key: stageTemplates.key, label: stageTemplates.label })
    .from(stageTemplates)
    .where(eq(stageTemplates.jurisdictionCode, code))
    .orderBy(asc(stageTemplates.sortOrder));
  const requirements = await db
    .select({
      key: documentRequirements.key,
      stageKey: documentRequirements.stageKey,
      label: documentRequirements.label,
      help: documentRequirements.help,
      expiryDays: documentRequirements.expiryDays,
    })
    .from(documentRequirements)
    .where(eq(documentRequirements.jurisdictionCode, code))
    .orderBy(asc(documentRequirements.sortOrder));
  return { code, stages, requirements };
}

export async function stageExists(tx: Tx, code: string, stageKey: string): Promise<boolean> {
  const [row] = await tx
    .select({ key: stageTemplates.key })
    .from(stageTemplates)
    .where(and(eq(stageTemplates.jurisdictionCode, code), eq(stageTemplates.key, stageKey)))
    .limit(1);
  return Boolean(row);
}

/** Stage keys and labels for one country, in order. */
export async function listStages(tx: Tx, code: string) {
  return tx
    .select({ key: stageTemplates.key, label: stageTemplates.label })
    .from(stageTemplates)
    .where(eq(stageTemplates.jurisdictionCode, code))
    .orderBy(asc(stageTemplates.sortOrder));
}
