import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(url: string, options: { max?: number; quiet?: boolean } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    ...(options.quiet ? { onnotice: () => {} } : {}),
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

/** Runs fn in a transaction scoped to one firm; row-level security hides every other firm's rows. */
export function withFirm<T>(db: Db, firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.firm_id', ${firmId}, true)`);
    return fn(tx);
  });
}
