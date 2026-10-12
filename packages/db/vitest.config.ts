import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load the repo .env so the integration suite can reach local Postgres.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Tests use their own database when one is set up, so they never touch development data.
for (const key of ["DATABASE_URL", "DATABASE_ADMIN_URL"]) {
  const test = process.env[`TEST_${key}`];
  if (test) process.env[key] = test;
}

export default defineConfig({});
