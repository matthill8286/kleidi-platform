import type { DomainEvent } from "@kleidi/kernel";

// Deadline events are filed under their case, so they appear in the case's activity.
type OnCase = { entityType: "case"; entityId: string; deadlineId: string; title: string };

export type DeadlineAdded = DomainEvent<
  "deadlines.DeadlineAdded",
  OnCase & { dueAt: string; ownerId: string }
>;
export type DeadlineChanged = DomainEvent<
  "deadlines.DeadlineChanged",
  OnCase & { dueAt?: string; ownerId?: string }
>;
export type DeadlineCompleted = DomainEvent<"deadlines.DeadlineCompleted", OnCase>;
export type DeadlineReopened = DomainEvent<"deadlines.DeadlineReopened", OnCase>;
export type DeadlineRemoved = DomainEvent<"deadlines.DeadlineRemoved", OnCase>;

export type ReminderDue = DomainEvent<
  "deadlines.ReminderDue",
  OnCase & { caseId: string; dueAt: string; ownerId: string; hoursBefore: number }
>;

export type DeadlinesEvent =
  | DeadlineAdded
  | DeadlineChanged
  | DeadlineCompleted
  | DeadlineReopened
  | DeadlineRemoved
  | ReminderDue;
