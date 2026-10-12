// Creates (or refreshes) the separate test database, so tests never touch development data.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !appUrl)
  throw new Error("TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL must be set");

const name = new URL(adminUrl).pathname.slice(1);
const server = new URL(adminUrl);
server.pathname = "/postgres";
const sql = postgres(server.toString(), { max: 1, onnotice: () => undefined });
try {
  const [exists] = await sql`select 1 from pg_database where datname = ${name}`;
  if (!exists) await sql.unsafe(`create database "${name}"`);
  await sql.unsafe(`grant connect on database "${name}" to kleidi_app`);
} finally {
  await sql.end();
}

const env = { ...process.env, DATABASE_ADMIN_URL: adminUrl, DATABASE_URL: appUrl };
const here = fileURLToPath(new URL(".", import.meta.url));
for (const script of ["migrate.ts", "seed.ts"]) {
  execFileSync(process.execPath, [`${here}${script}`], { env, stdio: "inherit" });
}
console.log(`Test database ${name} is ready.`);
