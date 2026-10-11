import { describe, expect, it } from "vitest";
import { dueReminderOffsets } from "./reminders.ts";

const dueAt = new Date("2026-10-12T09:00:00Z");
const deadline = { dueAt, remindBeforeHours: [72, 24], completedAt: null };

describe("dueReminderOffsets", () => {
  it("sends nothing before the first reminder window", () => {
    expect(dueReminderOffsets(deadline, [], new Date("2026-10-09T08:00:00Z"))).toEqual([]);
  });

  it("sends the 72-hour reminder once its window opens", () => {
    expect(dueReminderOffsets(deadline, [], new Date("2026-10-09T09:00:00Z"))).toEqual([72]);
  });

  it("skips reminders already sent", () => {
    expect(dueReminderOffsets(deadline, [72], new Date("2026-10-11T10:00:00Z"))).toEqual([24]);
  });

  it("sends nothing once the deadline is complete or past", () => {
    const done = { ...deadline, completedAt: new Date("2026-10-10T00:00:00Z") };
    expect(dueReminderOffsets(done, [], new Date("2026-10-11T10:00:00Z"))).toEqual([]);
    expect(dueReminderOffsets(deadline, [], new Date("2026-10-12T09:00:00Z"))).toEqual([]);
  });
});
