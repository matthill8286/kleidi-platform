import { and, asc, eq, isNull } from "drizzle-orm";
import { publishEvents, type Tx } from "@kleidi/db";
import { cases, caseStages } from "@kleidi/db/schema/cases";
import { AppError, systemClock, type Clock, type DomainEvent } from "@kleidi/kernel";
import { stageExists } from "../jurisdictions/index.ts";

export type CaseStageAdvanced = DomainEvent<
  "cases.StageAdvanced",
  { entityType: "case"; entityId: string; from: string; to: string }
>;

/** Lists the current firm's cases; the transaction must come from withFirm. */
export function listCases(tx: Tx) {
  return tx.select().from(cases).orderBy(asc(cases.createdAt));
}

export async function advanceStage(
  tx: Tx,
  input: {
    firmId: string;
    caseId: string;
    toStageKey: string;
    actorUserId: string;
    expectedVersion: number;
  },
  clock: Clock = systemClock,
): Promise<{ version: number }> {
  const [current] = await tx.select().from(cases).where(eq(cases.id, input.caseId)).limit(1);
  if (!current) throw new AppError("not_found", "Case not found");
  if (!(await stageExists(tx, current.jurisdictionCode, input.toStageKey))) {
    throw new AppError("invalid", `Unknown stage ${input.toStageKey}`);
  }

  const now = clock.now();
  const [updated] = await tx
    .update(cases)
    .set({ currentStageKey: input.toStageKey, updatedAt: now, version: current.version + 1 })
    .where(and(eq(cases.id, input.caseId), eq(cases.version, input.expectedVersion)))
    .returning({ version: cases.version });
  if (!updated)
    throw new AppError("conflict", "Someone else changed this case. Reload and try again.");

  await tx
    .update(caseStages)
    .set({ completedAt: now })
    .where(and(eq(caseStages.caseId, input.caseId), isNull(caseStages.completedAt)));
  await tx.insert(caseStages).values({
    firmId: input.firmId,
    caseId: input.caseId,
    stageKey: input.toStageKey,
    enteredAt: now,
  });

  const event: CaseStageAdvanced = {
    type: "cases.StageAdvanced",
    firmId: input.firmId,
    actorUserId: input.actorUserId,
    payload: {
      entityType: "case",
      entityId: input.caseId,
      from: current.currentStageKey,
      to: input.toStageKey,
    },
  };
  await publishEvents(tx, [event]);
  return updated;
}
