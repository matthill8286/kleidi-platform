import { inArray } from "drizzle-orm";
import type { Db, Tx } from "@kleidi/db";
import { users } from "@kleidi/db/schema/identity";

export type UserSummary = { id: string; name: string; email: string; locale: string };

/** Public lookup for other modules; they never read the users table directly. */
export async function findUsersByIds(db: Db | Tx, ids: string[]): Promise<UserSummary[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: users.id, name: users.name, email: users.email, locale: users.locale })
    .from(users)
    .where(inArray(users.id, ids));
}
