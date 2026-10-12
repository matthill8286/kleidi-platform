import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide, formatReference, gateAdvance, type CaseState, type Command } from "./domain.ts";

const CYPRUS = [
  "reservation",
  "due_diligence",
  "contract_signed",
  "contract_deposited",
  "payments",
  "final_approval",
  "title_transfer",
  "completed",
];
const start: CaseState = { stageKey: "reservation", status: "open" };

describe("case state machine", () => {
  it("walks a case through every stage to completion", () => {
    let state = start;
    for (let i = 1; i < CYPRUS.length; i++) {
      const d = decide(CYPRUS, state, { kind: "advance" });
      expect(d.ok).toBe(true);
      if (d.ok) state = d.next;
    }
    expect(state).toEqual({ stageKey: "completed", status: "completed" });
    expect(decide(CYPRUS, state, { kind: "advance" }).ok).toBe(false);
  });

  it("moves back only with a reason", () => {
    const at = { stageKey: "payments", status: "open" } as const;
    expect(decide(CYPRUS, at, { kind: "stepBack", reason: "" }).ok).toBe(false);
    expect(
      decide(CYPRUS, at, { kind: "stepBack", reason: "Deposit receipt was wrong" }),
    ).toMatchObject({
      ok: true,
      next: { stageKey: "contract_deposited", status: "open" },
    });
    expect(decide(CYPRUS, start, { kind: "stepBack", reason: "Wrong case" }).ok).toBe(false);
  });

  it("freezes held and cancelled cases", () => {
    const held = decide(CYPRUS, start, { kind: "hold", reason: "Buyer travelling" });
    expect(held.ok && held.next.status).toBe("on_hold");
    if (!held.ok) return;
    expect(decide(CYPRUS, held.next, { kind: "advance" }).ok).toBe(false);
    const resumed = decide(CYPRUS, held.next, { kind: "resume" });
    expect(resumed.ok && resumed.next).toEqual(start);
    const cancelled = decide(CYPRUS, start, { kind: "cancel", reason: "Sale fell through" });
    expect(cancelled.ok && cancelled.next.status).toBe("cancelled");
    if (cancelled.ok) expect(decide(CYPRUS, cancelled.next, { kind: "resume" }).ok).toBe(false);
  });

  it("formats references with a padded sequence", () => {
    expect(formatReference("CY", 2026, 7)).toBe("CY-2026-007");
    expect(formatReference("CY", 2026, 1234)).toBe("CY-2026-1234");
  });
});

const reason = fc.oneof(
  fc.constant(""),
  fc.constant("ok"),
  fc.string({ minLength: 3, maxLength: 20 }),
);
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.constant({ kind: "advance" as const }),
  fc.constant({ kind: "resume" as const }),
  reason.map((r) => ({ kind: "stepBack" as const, reason: r })),
  reason.map((r) => ({ kind: "hold" as const, reason: r })),
  reason.map((r) => ({ kind: "cancel" as const, reason: r })),
  reason.map((r) => ({ kind: "reopen" as const, reason: r })),
);

describe("case state machine properties", () => {
  it("never reaches an illegal state, whatever the sequence of commands", () => {
    fc.assert(
      fc.property(fc.array(command, { maxLength: 60 }), (commands) => {
        let state = start;
        for (const cmd of commands) {
          const before = state;
          const d = decide(CYPRUS, state, cmd);
          if (!d.ok) continue;
          state = d.next;
          const from = CYPRUS.indexOf(before.stageKey);
          const to = CYPRUS.indexOf(state.stageKey);
          // Stages always come from the template and move at most one step at a time.
          expect(to).toBeGreaterThanOrEqual(0);
          expect(Math.abs(to - from)).toBeLessThanOrEqual(1);
          // Only "advance" and "stepBack" move stages; status commands keep the stage.
          if (d.change === "status") expect(to).toBe(from);
          // Closed cases change only by being reopened, and then they are open again.
          if (before.status === "completed" || before.status === "cancelled") {
            expect(cmd.kind).toBe("reopen");
            expect(state.status).toBe("open");
          }
        }
        // A completed case always sits on the last stage.
        if (state.status === "completed") expect(state.stageKey).toBe(CYPRUS.at(-1));
      }),
      { numRuns: 2000 },
    );
  });

  it("can always finish an open case by advancing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: CYPRUS.length - 2 }), (i) => {
        let state: CaseState = { stageKey: CYPRUS[i]!, status: "open" };
        for (let step = i; step < CYPRUS.length - 1; step++) {
          const d = decide(CYPRUS, state, { kind: "advance" });
          if (!d.ok) return false;
          state = d.next;
        }
        return state.status === "completed";
      }),
    );
  });
});

describe("checklist gate", () => {
  it("lets a complete stage through and holds an incomplete one without a reason", () => {
    expect(gateAdvance([], undefined)).toBeNull();
    expect(gateAdvance(["title_deed"], undefined)?.key).toBe("stageIncomplete");
    expect(gateAdvance(["title_deed"], "no")?.params).toEqual({ count: 1 });
    expect(gateAdvance(["title_deed"], "Buyer's bank needs the contract first")).toBeNull();
  });
});

describe("reopening", () => {
  it("reopens a completed case at its last working stage, and only with a reason", () => {
    const done: CaseState = { stageKey: "completed", status: "completed" };
    expect(decide(CYPRUS, done, { kind: "reopen", reason: "" }).ok).toBe(false);
    expect(
      decide(CYPRUS, done, { kind: "reopen", reason: "Late receipt from the bank" }),
    ).toMatchObject({
      ok: true,
      next: { stageKey: "title_transfer", status: "open" },
    });
    expect(decide(CYPRUS, start, { kind: "reopen", reason: "Not closed" }).ok).toBe(false);
  });
});
