import { describe, expect, it } from "vitest";
import { cleanReminders, dueReminderOffsets, urgency } from "./reminders.ts";

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

describe("urgency", () => {
  const now = new Date("2026-10-12T06:00:00Z"); // 09:00 in Nicosia
  const at = (iso: string) => ({ dueAt: new Date(iso), completedAt: null });
  it("sorts deadlines by the Cyprus calendar day", () => {
    expect(urgency(at("2026-10-12T05:00:00Z"), now)).toBe("overdue");
    expect(urgency(at("2026-10-12T20:00:00Z"), now)).toBe("today"); // 23:00 in Nicosia
    expect(urgency(at("2026-10-12T21:30:00Z"), now)).toBe("week"); // already the 13th in Nicosia
    expect(urgency(at("2026-10-25T09:00:00Z"), now)).toBe("later");
    expect(urgency({ dueAt: new Date("2026-10-01"), completedAt: now }, now)).toBe("done");
  });

  it("keeps only offered reminder choices", () => {
    expect(cleanReminders([24, 72, 24, 5, 2])).toEqual([72, 24, 2]);
  });
});
