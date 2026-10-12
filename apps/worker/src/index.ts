import { PgBoss } from "pg-boss";
import { createDb } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import { announceDueReminders } from "@kleidi/modules/deadlines";
import {
  createClamdScanner,
  createS3Store,
  flagExpiringDocuments,
} from "@kleidi/modules/documents";
import {
  createBrevoNotifier,
  createSmtpNotifier,
  sendDailyDigests,
  type Notifier,
} from "@kleidi/modules/notifications";
import { buildConsumers, queueFor } from "./consumers.ts";
import { relayToConsumers } from "./relay.ts";

const env = {
  databaseUrl: process.env.DATABASE_URL,
  appUrl: process.env.WEB_ORIGIN ?? "http://localhost:5180",
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  mailFrom: process.env.MAIL_FROM ?? "Kleidi <no-reply@kleidi.local>",
  clamdHost: process.env.CLAMD_HOST ?? "localhost",
  clamdPort: Number(process.env.CLAMD_PORT ?? 3310),
};
if (!env.databaseUrl) throw new Error("DATABASE_URL is not set");

const { db, close } = createDb(env.databaseUrl, { max: 5 });
// Brevo when a key is set (staging and production); otherwise everything lands in Mailpit.
const notifier: Notifier = process.env.BREVO_API_KEY
  ? createBrevoNotifier({
      apiKey: process.env.BREVO_API_KEY,
      sender: {
        name: process.env.BREVO_SENDER_NAME ?? "Kleidi",
        email: process.env.BREVO_SENDER_EMAIL ?? "no-reply@kleidi.cy",
      },
      smsSender: process.env.BREVO_SMS_SENDER ?? "Kleidi",
    })
  : createSmtpNotifier({ host: env.smtpHost, port: env.smtpPort, from: env.mailFrom });
const store = createS3Store({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  publicEndpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
  region: process.env.S3_REGION ?? "fr-par",
  bucket: process.env.S3_BUCKET ?? "kleidi-documents",
  accessKeyId: process.env.S3_ACCESS_KEY ?? "",
  secretAccessKey: process.env.S3_SECRET_KEY ?? "",
});
const scanner = createClamdScanner({ host: env.clamdHost, port: env.clamdPort });
const consumers = buildConsumers({ db, notifier, appUrl: env.appUrl, store, scanner });

// The db migration creates the pgboss schema and hands it to the app role, which cannot create schemas.
const boss = new PgBoss({
  connectionString: env.databaseUrl,
  schema: "pgboss",
  createSchema: false,
});
boss.on("error", (error) => console.error("[worker]", error));
await boss.start();

for (const consumer of consumers) {
  const queue = queueFor(consumer.name);
  await boss.createQueue(queue, { retryLimit: 5, retryBackoff: true });
  await boss.work<StoredEvent>(queue, async (jobs) => {
    for (const job of jobs) await consumer.handle(job.data);
  });
}

const scheduled = [
  { name: "deadline-reminders", cron: "*/15 * * * *", run: () => announceDueReminders(db) },
  { name: "document-expiry", cron: "0 6 * * *", run: () => flagExpiringDocuments(db) },
  {
    name: "daily-digest",
    cron: "0 7 * * *",
    run: () => sendDailyDigests(db, notifier, env.appUrl),
  },
];
for (const job of scheduled) {
  await boss.createQueue(job.name, { retryLimit: 5, retryBackoff: true });
  await boss.schedule(job.name, job.cron, null, { tz: "Asia/Nicosia" });
  await boss.work(job.name, async () => {
    const result = await job.run();
    console.log(`[worker] ${job.name}`, JSON.stringify(result));
  });
}

// Relay the outbox every second; an overlapping tick is skipped rather than queued.
let relaying = false;
const relayTimer = setInterval(async () => {
  if (relaying) return;
  relaying = true;
  try {
    await relayToConsumers(db, consumers, async (consumer, event) => {
      await boss.send(queueFor(consumer.name), event);
    });
  } catch (error) {
    console.error("[worker] relay failed", error);
  } finally {
    relaying = false;
  }
}, 1000);

console.log(
  `[worker] started: ${[...consumers.map((c) => queueFor(c.name)), ...scheduled.map((j) => j.name)].join(", ")}`,
);

const shutdown = async () => {
  clearInterval(relayTimer);
  await boss.stop({ graceful: true });
  await close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
