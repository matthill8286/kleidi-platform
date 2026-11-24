import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Text in each language. English is always present; other languages fall back to it. */
export type Localised = { en: string; el?: string; ru?: string };

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
