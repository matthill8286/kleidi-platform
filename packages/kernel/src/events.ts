/** A fact that happened in one module and that other modules may react to. */
export type DomainEvent<TType extends string = string, TPayload = Record<string, unknown>> = {
  type: TType;
  firmId: string | null;
  actorUserId: string | null;
  payload: TPayload;
};

/** A domain event after it has been stored in the outbox. */
export type StoredEvent = DomainEvent & { id: string; position: number; occurredAt: string };
