# Running Kleidi on one server

The cheapest way to run Kleidi: everything on a single Linux server with Docker, about €15 to €18 a month on a Scaleway DEV1-M. It suits the demo and the lawyer interviews. For the pilot with real client files, move to the managed Scaleway set-up in `docs/runbook.md`. The code is identical; only the deployment differs.

## What runs on the server

Everything lives in `/opt/kleidi` and is described by `infra/server/compose.yml`.

| Service    | What it does                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `caddy`    | The only thing reachable from the internet. Serves HTTPS with free Let's Encrypt certificates. |
| `api`      | The API and the web app                                                                        |
| `worker`   | Events, reminders, digests and virus scanning (ClamAV is inside)                               |
| `postgres` | The database, reachable only by the other services                                             |
| `storage`  | Document storage (SeaweedFS) on the server's disk. Every request must be signed.               |
| `backup`   | Dumps the database every night at 02:00 and keeps 14 days                                      |
| `offsite`  | Copies the dumps and every document to a backup bucket at 03:00, once you set one              |
| `migrate`  | Runs once per release: migrations, security policies and reference data                        |

Browsers upload and download documents through Caddy at `/kleidi-documents/` on the app's own address, so no separate storage address is exposed.

The whole stack uses about 1.7 GB of memory, most of it ClamAV's virus signatures. Do not use a server with less than 4 GB.

## Setting it up

### 1. Create the server

In the Scaleway console, create an instance:

- **Type:** DEV1-M (3 vCPU, 4 GB), in the Paris region.
- **Image:** Ubuntu 24.04.
- **Public IPv4:** yes.
- **Your SSH key:** add it in the console as well, so you can log in yourself.
- **Cloud-init:** under **Advanced settings**, paste `cloud-init-staging.yml`. It is the same as `infra/server/cloud-init.yml`, with the deploy key filled in.

On first boot the server installs Docker, a firewall that only opens ports 22, 80 and 443, fail2ban and automatic security updates. It also creates the `deploy` user that GitHub Actions logs in as. Give it about five minutes.

### 2. Point your domain at it

At your domain registrar, add an `A` record for the app's address, for example `app.kleidi.cy`, pointing at the server's IPv4 address. Caddy needs this record before it can get a certificate.

### 3. Fill in GitHub

Do this at https://github.com/matthill8286/kleidi-platform/settings/environments, in the `staging` environment.

These secrets are already set: `DB_ADMIN_PASSWORD`, `DB_APP_PASSWORD`, `AUTH_SECRET`, `SERVER_SSH_KEY`, `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY`. Still to add:

| Kind     | Name                                     | Value                                                                       |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Secret   | `BREVO_API_KEY`                          | From your Brevo account                                                     |
| Variable | `SERVER_HOST`                            | The server's IPv4 address                                                   |
| Variable | `APP_HOSTNAME`                           | For example `app.kleidi.cy`                                                 |
| Variable | `ACME_EMAIL`                             | Your email, for certificate expiry warnings                                 |
| Variable | `MAIL_FROM_ADDRESS`                      | The address Kleidi sends from, on your Brevo-authenticated domain           |
| Variable | `FIRM_CREATORS`                          | Comma-separated emails allowed to create a firm. Leave empty to let anyone. |
| Variable | `BACKUP_BUCKET`                          | Optional: a Scaleway bucket for offsite copies                              |
| Secret   | `BACKUP_ACCESS_KEY`, `BACKUP_SECRET_KEY` | Optional: a Scaleway API key that can write to that bucket                  |

### 4. Deploy

In GitHub Actions, run **Deploy to server** and choose `staging`. The workflow:

1. checks that every setting is in place;
2. builds the images for this commit and sends them to the server over SSH;
3. writes `/opt/kleidi/.env` from the secrets;
4. migrates the database and restarts the services;
5. waits for `https://<APP_HOSTNAME>/health` to answer.

The first deploy takes about ten minutes, most of it sending the worker image. Later deploys are quicker.

## Day to day

Log in with `ssh root@<server>` or `ssh deploy@<server>`, then `cd /opt/kleidi`.

| Task                | Command                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| See what is running | `docker compose ps`                                                                                    |
| Follow the logs     | `docker compose logs -f api worker`                                                                    |
| Restart everything  | `docker compose restart`                                                                               |
| List the backups    | `ls -lh backups/`                                                                                      |
| Back up now         | `docker compose exec backup pg_dump -h postgres -U kleidi_admin -d kleidi -Fc -f /backups/manual.dump` |

## Restoring

To restore the database from a dump:

```bash
docker compose stop api worker
docker compose exec -T postgres pg_restore -U kleidi_admin -d kleidi --clean --if-exists < backups/kleidi-2026-10-12.dump
docker compose start api worker
```

If the server is lost:

1. Create a new server as in step 1.
2. Point the DNS at it.
3. Run the deploy.
4. Restore the latest dump from the backup bucket, as above.
5. Copy the documents back from `BACKUP_BUCKET/documents` with `rclone`.

Without a backup bucket, losing the server loses everything since its last snapshot. Set up the bucket, or take regular snapshots in the Scaleway console, before you put anything real on it.

## Trying it locally

The same stack runs on a Mac with Docker. Copy `infra/server` to a scratch folder and write a `.env` with:

- `IMAGE_TAG`;
- `SITE_ADDRESS=http://localhost` and `PUBLIC_URL=http://localhost:8088`;
- `HTTP_PORT=8088`;
- random values for the passwords and keys;
- `SMTP_HOST=host.docker.internal`, so mail goes to Mailpit.

Generate `s3.json` from the template, build the three images with `docker build --target`, then run `docker compose --profile release run --rm migrate` and `docker compose up -d`. This is how the set-up was tested before release: sign-up, email verification, two-factor sign-in, a case, an upload through Caddy, the ClamAV scan and the download all passed.
