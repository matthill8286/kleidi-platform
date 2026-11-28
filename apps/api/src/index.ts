import { createDb } from "@kleidi/db";
import { createAssistClient, createS3Store } from "@kleidi/modules/documents";
import { asLocale, createNotifierFromEnv } from "@kleidi/modules/notifications";
import { hasPendingInvitation } from "@kleidi/modules/firms";
import { createAuth } from "@kleidi/modules/identity";
import { createLicensing, mayStartLicence } from "@kleidi/modules/licensing";
import { buildApp } from "./app.ts";
import { firmCreators, licensingConfig, loadEnv, storageConfig } from "./env.ts";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const notifier = createNotifierFromEnv(process.env);
const licences = licensingConfig(env);
const licensing = licences ? createLicensing(licences) : undefined;
const auth = createAuth({
  // With licences checked, only people a firm invited or a licence names may make an account.
  ...(licensing
    ? {
        maySignUp: async ({ email, licenceId }) =>
          (await hasPendingInvitation(db, email)) ||
          (await mayStartLicence(licensing, licenceId, email)),
      }
    : {}),
  sendVerificationEmail: async ({ to, name, locale, url }) => {
    await notifier.send({
      channel: "email",
      to,
      template: "verify-email",
      locale: asLocale(locale),
      data: { name, link: url },
    });
  },
  sendResetPasswordEmail: async ({ to, name, locale, url }) => {
    await notifier.send({
      channel: "email",
      to,
      template: "reset-password",
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
const assist = env.ASSIST_URL
  ? createAssistClient({ url: env.ASSIST_URL, apiKey: env.ASSIST_API_KEY })
  : undefined;
const app = await buildApp({
  db,
  auth,
  store,
  notifier,
  assist,
  secureCookies: env.NODE_ENV === "production",
  storageOrigin: new URL(storageConfig(env).publicEndpoint).origin,
  rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
  trustedProxies: env.TRUSTED_PROXIES,
  production: env.NODE_ENV === "production",
  firmCreators: firmCreators(env),
  licensing,
  webOrigin: env.WEB_ORIGIN,
  webDist: env.WEB_DIST,
  logger: true,
});

app.log.info(
  licensing
    ? "Licences are checked with the account service, and sign-up is closed."
    : "Licences are not checked: ACCOUNT_INTERNAL_URL and ACCOUNT_TOKEN are not set.",
);

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
