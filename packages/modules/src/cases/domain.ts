export const CASE_STATUSES = ["open", "on_hold", "completed", "cancelled"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const PROPERTY_TYPES = ["resale", "offplan", "land"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export type CaseState = { stageKey: string; status: CaseStatus };

export type Command =
  | { kind: "advance" }
  | { kind: "stepBack"; reason: string }
  | { kind: "hold"; reason: string }
  | { kind: "resume" }
  | { kind: "cancel"; reason: string };

/** Why a command was refused: a translation key for the web app, and English text. */
export type Refusal = { key: string; text: string; params?: { status: CaseStatus } };

export type Decision =
  { ok: true; next: CaseState; change: "stage" | "status" } | { ok: false; reason: Refusal };

const no = (key: string, text: string, status?: CaseStatus): Decision => ({
  ok: false,
  reason: status ? { key, text, params: { status } } : { key, text },
});

const MIN_REASON = 3;
const hasReason = (r: string) => r.trim().length >= MIN_REASON;

/**
 * The case state machine. Stages come from the jurisdiction template, in order; the last
 * stage completes the case. A case moves one stage at a time: forward freely, back only
 * with a reason. Held, completed and cancelled cases do not move.
 */
export function decide(stages: readonly string[], state: CaseState, command: Command): Decision {
  const index = stages.indexOf(state.stageKey);
  if (index < 0) return no("unknownStage", `Unknown stage ${state.stageKey}`);
  const last = stages.length - 1;

  switch (command.kind) {
    case "advance": {
      if (state.status !== "open")
        return no("cannotMove", `A ${state.status} case cannot move`, state.status);
      if (index === last) return no("atLastStage", "The case is already at its last stage");
      const stageKey = stages[index + 1]!;
      return {
        ok: true,
        change: "stage",
        next: { stageKey, status: index + 1 === last ? "completed" : "open" },
      };
    }
    case "stepBack": {
      if (state.status !== "open")
        return no("cannotMove", `A ${state.status} case cannot move`, state.status);
      if (index === 0) return no("atFirstStage", "The case is already at its first stage");
      if (!hasReason(command.reason)) return no("reasonStepBack", "Give a reason for moving back");
      return { ok: true, change: "stage", next: { stageKey: stages[index - 1]!, status: "open" } };
    }
    case "hold": {
      if (state.status !== "open")
        return no("onlyOpenHold", "Only an open case can be put on hold");
      if (!hasReason(command.reason)) return no("reasonHold", "Give a reason for the hold");
      return { ok: true, change: "status", next: { ...state, status: "on_hold" } };
    }
    case "resume": {
      if (state.status !== "on_hold")
        return no("onlyHeldResume", "Only a held case can be resumed");
      return { ok: true, change: "status", next: { ...state, status: "open" } };
    }
    case "cancel": {
      if (state.status === "completed" || state.status === "cancelled") {
        return no("cannotCancel", `A ${state.status} case cannot be cancelled`, state.status);
      }
      if (!hasReason(command.reason)) return no("reasonCancel", "Give a reason for cancelling");
      return { ok: true, change: "status", next: { ...state, status: "cancelled" } };
    }
  }
}

/** "CY-2026-007": the jurisdiction, the year opened and a per-firm, per-year sequence. */
export const formatReference = (jurisdiction: string, year: number, sequence: number): string =>
  `${jurisdiction}-${year}-${String(sequence).padStart(3, "0")}`;
