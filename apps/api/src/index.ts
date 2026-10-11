import { createDb } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const auth = createAuth({
  db,
  baseURL: env.WEB_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
});
const app = await buildApp({
  db,
  auth,
  webOrigin: env.WEB_ORIGIN,
  webDist: env.WEB_DIST,
  logger: true,
});

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
