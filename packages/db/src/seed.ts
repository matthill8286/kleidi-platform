import { createDb, schema } from "./index.ts";
import { CYPRUS_REQUIREMENTS, CYPRUS_STAGES } from "./seed-data/cyprus.ts";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set");

const { db, close } = createDb(url, { max: 1 });
try {
  await db
    .insert(schema.jurisdictions)
    .values({ code: "CY", name: "Cyprus", defaultLocale: "el" })
    .onConflictDoNothing();

  await db
    .insert(schema.stageTemplates)
    .values(
      CYPRUS_STAGES.map((s, i) => ({ ...s, jurisdictionCode: "CY", sortOrder: (i + 1) * 10 })),
    )
    .onConflictDoNothing();

  await db
    .insert(schema.documentRequirements)
    .values(
      CYPRUS_REQUIREMENTS.map((r, i) => ({
        ...r,
        expiryDays: r.expiryDays ?? null,
        jurisdictionCode: "CY",
        sortOrder: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing();

  // Demo firms and users are created by `pnpm --filter @kleidi/api seed:demo`, through Better Auth.
  console.log("Reference data seeded.");
} finally {
  await close();
}
