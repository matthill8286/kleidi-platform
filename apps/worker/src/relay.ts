import { relayOutbox, type Db } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import type { Consumer } from "./consumers.ts";

/** Fans each outbox event out to every consumer that accepts it. */
export function relayToConsumers(
  db: Db,
  consumers: Consumer[],
  enqueue: (consumer: Consumer, event: StoredEvent) => Promise<void>,
): Promise<number> {
  return relayOutbox(db, async (event) => {
    for (const consumer of consumers) {
      if (consumer.accepts(event.type)) await enqueue(consumer, event);
    }
  });
}
