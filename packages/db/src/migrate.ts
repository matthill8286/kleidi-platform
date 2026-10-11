import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./index.ts";
import { policiesSql } from "./policies.ts";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is not set");

const { db, close } = createDb(url, { max: 1, quiet: true });
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  await db.$client.unsafe(policiesSql());
  console.log("Migrations and policies applied.");
} finally {
  await close();
}
