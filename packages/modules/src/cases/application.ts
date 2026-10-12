import { and, asc, desc, eq, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { publishEvents, withFirm, type Db, type Tx } from "@kleidi/db";
import { caseCounters, caseParties, cases, caseStages } from "@kleidi/db/schema/cases";
import { AppError, systemClock, type Clock, type DomainEvent } from "@kleidi/kernel";
import {
  getFirmJurisdiction,
  getMembership,
  type Actor,
  type FirmContext,
} from "../firms/index.ts";
import { findUsersByIds } from "../identity/index.ts";
import { listStages } from "../jurisdictions/index.ts";
import {
  decide,
  formatReference,
  type CaseStatus,
  type Command,
  type PropertyType,
} from "./domain.ts";
import type { CaseOpened, CaseStageChanged, CaseStatusChanged, PartyAdded } from "./events.ts";

export const PARTY_ROLES = ["buyer", "seller", "developer", "bank"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export type PartyInput = {
  role: PartyRole;
  fullName: string;
  email?: string | undefined;
  phone?: string | undefined;
};

export type OpenCaseInput = {
  firm: FirmContext;
  actor: Actor;
  propertyAddress: string;
  plotOrRegNo?: string | undefined;
  propertyType: PropertyType;
  developerName?: string | undefined;
  assignedLawyerId?: string | undefined;
  parties: PartyInput[];
};

const entity = (id: string, reference: string) => ({
  entityType: "case" as const,
  entityId: id,
  reference,
});

/** Next per-firm, per-year number. The upsert holds a row lock, so references never repeat. */
async function nextSequence(tx: Tx, firmId: string, year: number): Promise<number> {
  const [row] = await tx
    .insert(caseCounters)
    .values({ firmId, year, last: 1 })
    .onConflictDoUpdate({
      target: [caseCounters.firmId, caseCounters.year],
      set: { last: sql`${caseCounters.last} + 1` },
    })
    .returning({ last: caseCounters.last });
  if (!row) throw new Error("Case counter upsert returned no row");
  return row.last;
}

export async function openCase(db: Db, input: OpenCaseInput, clock: Clock = systemClock) {
  if (!input.parties.some((p) => p.role === "buyer")) {
    throw new AppError("invalid", "A case needs at least one buyer", "caseNeedsBuyer");
  }
  const lawyerId = input.assignedLawyerId ?? input.actor.userId;
  if (!(await getMembership(db, lawyerId, input.firm.firmId))) {
    throw new AppError("invalid", "The assigned lawyer is not in this firm", "lawyerNotInFirm");
  }
  const jurisdiction = await getFirmJurisdiction(db, input.firm.firmId);

  return withFirm(db, input.firm.firmId, async (tx) => {
    const stages = await listStages(tx, jurisdiction);
    const first = stages[0];
    if (!first) throw new AppError("invalid", `No case template for ${jurisdiction}`);

    const now = clock.now();
    const year = now.getUTCFullYear();
    const reference = formatReference(
      jurisdiction,
      year,
      await nextSequence(tx, input.firm.firmId, year),
    );
    const [created] = await tx
      .insert(cases)
      .values({
        firmId: input.firm.firmId,
        jurisdictionCode: jurisdiction,
        reference,
        propertyAddress: input.propertyAddress.trim(),
        plotOrRegNo: input.plotOrRegNo?.trim() || null,
        propertyType: input.propertyType,
        developerName: input.developerName?.trim() || null,
        currentStageKey: first.key,
        assignedLawyerId: lawyerId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Case insert returned no row");

    await tx.insert(caseStages).values({
      firmId: input.firm.firmId,
      caseId: created.id,
      stageKey: first.key,
      enteredAt: now,
    });
    const parties = await tx
      .insert(caseParties)
      .values(
        input.parties.map((p) => ({
          firmId: input.firm.firmId,
          caseId: created.id,
          role: p.role,
          fullName: p.fullName.trim(),
          email: p.email?.trim() || null,
          phone: p.phone?.trim() || null,
        })),
      )
      .returning();

    const buyer = parties.find((p) => p.role === "buyer")!.fullName;
    const opened: CaseOpened = {
      type: "cases.CaseOpened",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        ...entity(created.id, reference),
        propertyAddress: created.propertyAddress ?? "",
        buyer,
      },
    };
    await publishEvents(tx, [opened]);
    return created;
  });
}

/** Loads the case for a change and checks the caller saw the latest version. */
async function loadForChange(tx: Tx, caseId: string, expectedVersion: number) {
  const [current] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!current) throw new AppError("not_found", "Case not found", "caseNotFound");
  if (current.version !== expectedVersion) {
    throw new AppError(
      "precondition_failed",
      "This case changed since you loaded it. Reload and try again.",
      "caseChanged",
    );
  }
  return current;
}

/** Writes the new version, guarded on the old one so concurrent writers cannot both win. */
async function bumpVersion(
  tx: Tx,
  caseId: string,
  version: number,
  set: Partial<typeof cases.$inferInsert>,
) {
  const [updated] = await tx
    .update(cases)
    .set({ ...set, version: version + 1 })
    .where(and(eq(cases.id, caseId), eq(cases.version, version)))
    .returning();
  if (!updated) {
    throw new AppError(
      "precondition_failed",
      "This case changed since you loaded it. Reload and try again.",
      "caseChanged",
    );
  }
  return updated;
}

export async function transitionCase(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    expectedVersion: number;
    command: Command;
  },
  clock: Clock = systemClock,
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const current = await loadForChange(tx, input.caseId, input.expectedVersion);
    const stages = (await listStages(tx, current.jurisdictionCode)).map((s) => s.key);
    const decision = decide(
      stages,
      { stageKey: current.currentStageKey, status: current.status },
      input.command,
    );
    if (!decision.ok) throw AppError.from("invalid", decision.reason);

    const now = clock.now();
    const { next } = decision;
    const reason = "reason" in input.command ? input.command.reason.trim() : null;
    const terminal = next.status === "completed" || next.status === "cancelled";
    const updated = await bumpVersion(tx, current.id, current.version, {
      currentStageKey: next.stageKey,
      status: next.status,
      statusReason: next.status === "on_hold" || next.status === "cancelled" ? reason : null,
      closedAt: terminal ? now : null,
      updatedAt: now,
    });

    const events: DomainEvent[] = [];
    const base = { firmId: input.firm.firmId, actorUserId: input.actor.userId };
    if (next.stageKey !== current.currentStageKey) {
      await tx
        .update(caseStages)
        .set({ completedAt: now })
        .where(and(eq(caseStages.caseId, current.id), isNull(caseStages.completedAt)));
      await tx.insert(caseStages).values({
        firmId: input.firm.firmId,
        caseId: current.id,
        stageKey: next.stageKey,
        enteredAt: now,
        // The last stage is done the moment the case reaches it.
        completedAt: next.status === "completed" ? now : null,
      });
      const back = input.command.kind === "stepBack";
      const changed: CaseStageChanged = {
        ...base,
        type: "cases.StageChanged",
        payload: {
          ...entity(current.id, current.reference),
          from: current.currentStageKey,
          to: next.stageKey,
          direction: back ? "back" : "forward",
          reason: back ? reason : null,
        },
      };
      events.push(changed);
    }
    if (next.status !== current.status) {
      const changed: CaseStatusChanged = {
        ...base,
        type: "cases.StatusChanged",
        payload: {
          ...entity(current.id, current.reference),
          from: current.status,
          to: next.status,
          reason,
        },
      };
      events.push(changed);
    }
    await publishEvents(tx, events);
    return updated;
  });
}

export async function addParty(
  db: Db,
  input: {
    firm: FirmContext;
    actor: Actor;
    caseId: string;
    expectedVersion: number;
    party: PartyInput;
  },
  clock: Clock = systemClock,
) {
  return withFirm(db, input.firm.firmId, async (tx) => {
    const current = await loadForChange(tx, input.caseId, input.expectedVersion);
    if (current.status === "completed" || current.status === "cancelled") {
      throw new AppError("invalid", `A ${current.status} case cannot change`, "caseClosed", {
        status: current.status,
      });
    }
    const updated = await bumpVersion(tx, current.id, current.version, { updatedAt: clock.now() });
    const [party] = await tx
      .insert(caseParties)
      .values({
        firmId: input.firm.firmId,
        caseId: current.id,
        role: input.party.role,
        fullName: input.party.fullName.trim(),
        email: input.party.email?.trim() || null,
        phone: input.party.phone?.trim() || null,
      })
      .returning();
    if (!party) throw new Error("Party insert returned no row");
    const added: PartyAdded = {
      type: "cases.PartyAdded",
      firmId: input.firm.firmId,
      actorUserId: input.actor.userId,
      payload: {
        ...entity(current.id, current.reference),
        partyId: party.id,
        role: party.role,
        fullName: party.fullName,
      },
    };
    await publishEvents(tx, [added]);
    return updated;
  });
}

/** One case with its parties, stage history and the template it moves through. */
export async function getCase(db: Db, firmId: string, caseId: string) {
  return withFirm(db, firmId, async (tx) => {
    const [row] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
    if (!row) throw new AppError("not_found", "Case not found", "caseNotFound");
    const [parties, history, template] = await Promise.all([
      tx
        .select()
        .from(caseParties)
        .where(eq(caseParties.caseId, caseId))
        .orderBy(asc(caseParties.role)),
      tx
        .select()
        .from(caseStages)
        .where(eq(caseStages.caseId, caseId))
        .orderBy(asc(caseStages.enteredAt)),
      listStages(tx, row.jurisdictionCode),
    ]);
    const [lawyer] = row.assignedLawyerId ? await findUsersByIds(tx, [row.assignedLawyerId]) : [];
    return {
      ...row,
      assignedLawyer: lawyer ? { id: lawyer.id, name: lawyer.name } : null,
      parties: parties.map(({ firmId: _f, caseId: _c, userId: _u, ...p }) => p),
      history: history.map(({ stageKey, enteredAt, completedAt }) => ({
        stageKey,
        enteredAt,
        completedAt,
      })),
      stages: template,
    };
  });
}

export type CaseCursor = { createdAt: string; id: string };

export const encodeCursor = (c: CaseCursor) => Buffer.from(JSON.stringify(c)).toString("base64url");

export function decodeCursor(raw: string): CaseCursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as CaseCursor;
    if (typeof c.createdAt === "string" && typeof c.id === "string") return c;
  } catch {
    // fall through
  }
  throw new AppError("invalid", "The cursor is not valid");
}

/** Newest first, keyset-paginated so pages stay stable while cases are added. */
export async function listCases(
  db: Db,
  firmId: string,
  options: {
    status?: CaseStatus | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const filters: SQL[] = [];
  if (options.status) filters.push(eq(cases.status, options.status));
  if (options.q?.trim()) {
    const term = `%${options.q.trim().replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(or(ilike(cases.reference, term), ilike(cases.propertyAddress, term))!);
  }
  if (options.cursor) {
    const c = decodeCursor(options.cursor);
    const at = new Date(c.createdAt);
    filters.push(or(lt(cases.createdAt, at), and(eq(cases.createdAt, at), lt(cases.id, c.id)))!);
  }

  return withFirm(db, firmId, async (tx) => {
    const rows = await tx
      .select({
        id: cases.id,
        reference: cases.reference,
        propertyAddress: cases.propertyAddress,
        propertyType: cases.propertyType,
        currentStageKey: cases.currentStageKey,
        status: cases.status,
        assignedLawyerId: cases.assignedLawyerId,
        createdAt: cases.createdAt,
        updatedAt: cases.updatedAt,
        // Qualified by hand: inside a subquery Drizzle leaves column names unqualified.
        buyers: sql<string[]>`coalesce((
          select array_agg(cp.full_name order by cp.full_name)
          from case_parties cp
          where cp.case_id = "cases"."id" and cp.role = 'buyer'
        ), '{}')`,
      })
      .from(cases)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(cases.createdAt), desc(cases.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  });
}

/** The few case facts other modules need. Null when the case is not in the current firm. */
export async function findCase(tx: Tx, caseId: string) {
  const [row] = await tx
    .select({
      id: cases.id,
      reference: cases.reference,
      jurisdictionCode: cases.jurisdictionCode,
      status: cases.status,
      currentStageKey: cases.currentStageKey,
      assignedLawyerId: cases.assignedLawyerId,
    })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  return row ?? null;
}
