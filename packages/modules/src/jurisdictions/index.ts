import { and, asc, eq } from "drizzle-orm";
import type { Db, Tx } from "@kleidi/db";
import { documentRequirements, stageTemplates } from "@kleidi/db/schema/jurisdictions";

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
