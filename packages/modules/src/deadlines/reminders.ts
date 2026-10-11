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
