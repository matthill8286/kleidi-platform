import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      "postgres://kleidi_admin:kleidi_admin@localhost:5434/kleidi",
  },
});
