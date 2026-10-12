import { createDb } from "@kleidi/db";
import { createS3Store } from "@kleidi/modules/documents";
import { asLocale, createNotifierFromEnv } from "@kleidi/modules/notifications";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "./app.ts";
import { loadEnv, storageConfig } from "./env.ts";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const notifier = createNotifierFromEnv(process.env);
const auth = createAuth({
  sendVerificationEmail: async ({ to, name, locale, url }) => {
    await notifier.send({
      channel: "email",
      to,
      template: "verify-email",
      locale: asLocale(locale),
      data: { name, link: url },
    });
  },
  db,
  baseURL: env.WEB_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
});
const store = createS3Store(storageConfig(env));
await store.ensureBucket();
const app = await buildApp({
  db,
  auth,
  store,
  notifier,
  secureCookies: env.NODE_ENV === "production",
  storageOrigin: new URL(storageConfig(env).publicEndpoint).origin,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  trustedProxies: env.TRUSTED_PROXIES,
  production: env.NODE_ENV === "production",
  firmCreators: env.FIRM_CREATORS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
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
