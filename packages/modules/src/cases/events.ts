import type { DomainEvent } from "@kleidi/kernel";
import type { CaseStatus } from "./domain.ts";

type CaseEntity = { entityType: "case"; entityId: string; reference: string };

export type CaseOpened = DomainEvent<
  "cases.CaseOpened",
  CaseEntity & { propertyAddress: string; buyer: string }
>;

export type CaseStageChanged = DomainEvent<
  "cases.StageChanged",
  CaseEntity & {
    from: string;
    to: string;
    direction: "forward" | "back";
    reason: string | null;
    // Checklist items left unfinished when a lawyer moved on anyway.
    skipped: string[];
  }
>;

export type CaseStatusChanged = DomainEvent<
  "cases.StatusChanged",
  CaseEntity & { from: CaseStatus; to: CaseStatus; reason: string | null }
>;

export type PartyAdded = DomainEvent<
  "cases.PartyAdded",
  CaseEntity & { partyId: string; role: string; fullName: string }
>;

export type CasesEvent = CaseOpened | CaseStageChanged | CaseStatusChanged | PartyAdded;
