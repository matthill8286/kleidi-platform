import { PgBoss } from "pg-boss";
import { createDb } from "@kleidi/db";
import type { StoredEvent } from "@kleidi/kernel";
import { announceDueReminders } from "@kleidi/modules/deadlines";
import { summariseExpiringDocuments } from "@kleidi/modules/documents";
import { createSmtpNotifier } from "@kleidi/modules/notifications";
import { buildConsumers, queueFor } from "./consumers.ts";
import { relayToConsumers } from "./relay.ts";

const env = {
  databaseUrl: process.env.DATABASE_URL,
  appUrl: process.env.WEB_ORIGIN ?? "http://localhost:5180",
  smtpHost: process.env.SMTP_HOST ?? "localhost",
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  mailFrom: process.env.MAIL_FROM ?? "Kleidi <no-reply@kleidi.local>",
};
if (!env.databaseUrl) throw new Error("DATABASE_URL is not set");

const { db, close } = createDb(env.databaseUrl, { max: 5 });
const notifier = createSmtpNotifier({ host: env.smtpHost, port: env.smtpPort, from: env.mailFrom });
const consumers = buildConsumers({ db, notifier, appUrl: env.appUrl });

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
  { name: "document-expiry", cron: "0 6 * * *", run: () => summariseExpiringDocuments(db) },
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
