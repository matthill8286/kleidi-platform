const HOUR_MS = 60 * 60 * 1000;

/**
 * Returns the reminder offsets (hours before due) whose send time has passed and that
 * have not been sent yet. Safe to call on every worker tick.
 */
export function dueReminderOffsets(
  deadline: { dueAt: Date; remindBeforeHours: number[]; completedAt: Date | null },
  alreadySent: number[],
  now: Date,
): number[] {
  if (deadline.completedAt || now >= deadline.dueAt) return [];
  return deadline.remindBeforeHours
    .filter((hours) => !alreadySent.includes(hours))
    .filter((hours) => now.getTime() >= deadline.dueAt.getTime() - hours * HOUR_MS)
    .sort((a, b) => b - a);
}

// The reminder offsets a lawyer can pick: a week, three days, a day and two hours ahead.
export const REMINDER_CHOICES = [168, 72, 24, 2] as const;

export type Urgency = "done" | "overdue" | "today" | "week" | "later";

/** Where a deadline sits for the lawyer, judged by the calendar day in Cyprus. */
export function urgency(deadline: { dueAt: Date; completedAt: Date | null }, now: Date): Urgency {
  if (deadline.completedAt) return "done";
  if (deadline.dueAt <= now) return "overdue";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Nicosia" });
  if (day(deadline.dueAt) === day(now)) return "today";
  return deadline.dueAt.getTime() - now.getTime() <= 7 * 24 * HOUR_MS ? "week" : "later";
}

/** Keeps only offered choices, without repeats, latest first. */
export const cleanReminders = (hours: number[]): number[] =>
  [...new Set(hours)]
    .filter((h) => (REMINDER_CHOICES as readonly number[]).includes(h))
    .sort((a, b) => b - a);
