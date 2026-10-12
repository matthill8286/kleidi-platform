# Kleidi runbook

How to run Kleidi in production: setting it up, releasing, restoring, and handling incidents.

## What runs where

Everything runs in Scaleway's Paris region (fr-par), so client data stays in the EU.

| Piece     | What it is                                                     | Notes                                                         |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `api`     | Serverless container: the API plus the built web app           | 1 vCPU, 1 GB, 1 to 4 instances, public on the app domain      |
| `worker`  | Serverless container: the outbox relay, scheduled jobs, ClamAV | 1 vCPU, 2 GB, exactly 1 instance, private                     |
| `migrate` | Serverless job run once per release                            | Applies migrations and row-level security policies            |
| Postgres  | Managed database, encrypted at rest                            | Daily backups kept 14 days; high availability in prod         |
| Documents | Private object bucket with versioning                          | Uploads land in `quarantine/`, which is cleared after 30 days |
| Brevo     | Email and SMS                                                  | EU-hosted                                                     |

All three are built from the one `Dockerfile` in the repository (targets `api`, `worker` and `migrate`). The infrastructure is defined in `infra/opentofu`.

## First-time set-up

1. **Create the Scaleway project.** Then create an API key with access to Containers, Jobs, Registry, Databases and Object Storage.
2. **Create the state bucket.** Create the private bucket `kleidi-tofu-state` by hand. OpenTofu stores its state there.
3. **Generate the state encryption key.** Store the encryption configuration as the `TF_ENCRYPTION` secret. The state contains database passwords, so it must never be stored unencrypted.
4. **Add the GitHub secrets.** For the `staging` and `prod` environments, add:
   - `SCW_ACCESS_KEY`, `SCW_SECRET_KEY` and `SCW_PROJECT_ID`;
   - `DB_ADMIN_PASSWORD` and `DB_APP_PASSWORD`;
   - `AUTH_SECRET`, made with `openssl rand -base64 48`;
   - `BREVO_API_KEY` and `TF_ENCRYPTION`.
5. **Add the GitHub variables.**
   - `APP_HOSTNAME`, for example `app.kleidi.cy`.
   - `FIRM_CREATORS`, a list in OpenTofu syntax: `["admin@pilotfirm.cy"]`.
6. **Set up Brevo.**
   - Authenticate the sending domain with SPF, DKIM and DMARC.
   - Register the SMS sender name "Kleidi".
   - Without these steps, mail lands in spam and texts may not be delivered.
7. **Point DNS.** Point `APP_HOSTNAME` at the api container, using the CNAME that Scaleway shows for the container domain.
8. **Deploy.** Run the Deploy workflow for `staging`. Once staging works, run it for `prod`.

## Releasing

1. Merge to `main`. CI runs formatting, lint, the module boundaries, typecheck, tests and the build.
2. In GitHub Actions, run **Deploy** and choose the environment. The workflow then:
   - builds and pushes the `api`, `worker` and `migrate` images, tagged with the commit SHA;
   - runs the migrate job, and stops if it fails;
   - rolls the api and worker over to the new images;
   - waits for `/health` to answer.

**Migrations only move forward.** Write each migration so the previous release still works against it. Add a column first and use it in a later release; remove the old column one release after that. This keeps rollbacks safe.

## Rolling back

Run **Deploy** again from the previous good commit. The migration step makes no changes when there is nothing new, and the containers go back to the old images. If a migration itself was wrong, write a new migration that corrects it. Never edit an applied migration.

## Backups and restoring

- **Database:** Scaleway takes a backup every day and keeps it for 14 days. To restore one, open the database in the Scaleway console, choose **Backups**, then **Restore to a new instance**. Point a staging deployment at the new instance and check it. Only then switch production over.
- **Documents:** the bucket keeps every version of every object. A deleted or overwritten file can be restored from the versions list in the console.
- **Monthly drill:** restore the latest backup into a new instance and run `infra/scripts/restore-drill.sh` against it. Set `PGHOST`, `PGUSER` and `PGPASSWORD`, and change `PG` in the script to plain `psql`. Record the result in `docs/hardening-report.md`.

## Monitoring

- **Logs:** Scaleway Cockpit collects container logs. Sign-in tokens are redacted from request logs.
- **Health:** `GET /health` checks the database. Point an uptime monitor at it, checking every minute.
- **Event backlog:** if the worker falls behind, this query shows how many events are waiting:

  ```sql
  select name, count(*) from pgboss.job where state = 'created' group by 1;
  ```

  A count that keeps growing means the worker is down or stuck. Restart the worker container.

## Incidents

| Symptom                                | Likely cause                                               | What to do                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The site is down, or `/health` fails   | API container or database down                             | Check both in the Scaleway console. Restart the container. If the database failed over, wait for it to finish.                                                                                                                              |
| Uploads stay at "Checking for viruses" | Worker down, or ClamAV not ready                           | Check the worker logs for `clamd` errors and restart the worker. Files wait in quarantine, so nothing is lost.                                                                                                                              |
| Emails or texts are not arriving       | Brevo outage, or the domain is not authenticated           | Check Brevo's status page and logs. Failed sends retry and stay in the `notifications` table with status `failed`.                                                                                                                          |
| A client never gets their code         | The country is not on the SMS list, or the number is wrong | Check the party's phone number. The allowed countries are in `packages/modules/src/identity/users.ts`.                                                                                                                                      |
| A lawyer has lost their authenticator  | New phone                                                  | They sign in with a backup code and set up again under Security. If they have no backup code, a firm admin cannot reset it yet. An operator removes their two-factor row after verifying who they are by phone.                             |
| A suspected breach                     | Leaked secret, or a compromised account                    | Rotate `AUTH_SECRET`, which signs everyone out. Rotate the database and storage keys. Revoke portal access for the affected cases. Preserve the logs. Notify the Data Protection Commissioner within 72 hours if personal data was exposed. |

## Rotating secrets

- **`AUTH_SECRET`:** change the GitHub secret and deploy. Every session ends and everyone signs in again.
- **Database passwords:** change the GitHub secret and deploy. OpenTofu updates the user and the containers in the same run.
- **Scaleway and Brevo keys:** create the new key, update the secret, deploy, then delete the old key.

## Routine tasks

- **Monthly:** run the restore drill, and check that the event backlog is empty.
- **Quarterly:** review who is a member of each firm, update dependencies, and re-run the ZAP scan and the load test (`infra/load/run.ts`).
- **Every release:** CI must be green. Releases go to staging before prod.
