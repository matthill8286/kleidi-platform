import { sql } from "drizzle-orm";
import { createDb, schema } from "./index.ts";
import { JURISDICTIONS } from "./seed-data/index.ts";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set");

const { db, close } = createDb(url, { max: 1 });
try {
  for (const j of JURISDICTIONS) {
    const { stages, requirements, ...row } = j;
    // Jurisdiction settings follow the seed file, so a changed time zone reaches existing databases.
    await db
      .insert(schema.jurisdictions)
      .values(row)
      .onConflictDoUpdate({
        target: schema.jurisdictions.code,
        set: {
          name: sql`excluded.name`,
          defaultLocale: sql`excluded.default_locale`,
          timezone: sql`excluded.timezone`,
          phoneExample: sql`excluded.phone_example`,
          asksTenure: sql`excluded.asks_tenure`,
          currency: sql`excluded.currency`,
        },
      });

    await db
      .insert(schema.stageTemplates)
      .values(stages.map((s, i) => ({ ...s, jurisdictionCode: j.code, sortOrder: (i + 1) * 10 })))
      // Wording and client guidance follow the seed file.
      .onConflictDoUpdate({
        target: [schema.stageTemplates.jurisdictionCode, schema.stageTemplates.key],
        set: {
          label: sql`excluded.label`,
          clientNow: sql`excluded.client_now`,
          clientAction: sql`excluded.client_action`,
        },
      });

    await db
      .insert(schema.documentRequirements)
      .values(
        requirements.map((r, i) => ({
          ...r,
          expiryDays: r.expiryDays ?? null,
          jurisdictionCode: j.code,
          sortOrder: (i + 1) * 10,
        })),
      )
      .onConflictDoNothing();
  }

  // Demo firms and users are created by `pnpm --filter @kleidi/api seed:demo`, through Better Auth.
  console.log("Reference data seeded.");
} finally {
  await close();
}
