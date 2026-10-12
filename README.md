# Kleidi platform

Kleidi tracks every Cypriot property sale from reservation to title deed transfer. This repository holds the MVP: a law firm workspace and a buyer portal, in Greek, English and Russian.

## Layout

| Path               | What it is                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | React + Vite single-page app (TanStack Router, TanStack Query, i18next, Tailwind)                                   |
| `apps/api`         | Fastify API with Zod validation and a generated OpenAPI document at `/openapi.json`                                 |
| `apps/worker`      | pg-boss worker: outbox relay, event consumers, deadline reminders, expiry checks                                    |
| `packages/kernel`  | Shared kernel: errors, domain event types, clock                                                                    |
| `packages/db`      | Drizzle schema (one file per module), migrations, RLS policies, outbox helpers                                      |
| `packages/modules` | Bounded-context modules: identity, firms, jurisdictions, cases, documents, deadlines, consent, notifications, audit |
| `packages/i18n`    | Shared translations for `en`, `el` and `ru`                                                                         |
| `infra/opentofu`   | Scaleway infrastructure skeleton (not yet applied)                                                                  |

## Getting started

Requires Node 24, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env
pnpm services:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

ClamAV loads its virus signatures for a few minutes on first start. Until it is ready, uploads wait in quarantine and are scanned once it answers.

Open http://localhost:5180, create an account and set up an authenticator app. Invitation and reminder emails land in Mailpit at http://localhost:8025.

To sign in as the local test user, put `DEV_LOGIN_EMAIL` and `DEV_LOGIN_PASSWORD` in `.env` and run `pnpm --filter @kleidi/api dev:totp` for the current authenticator code.

The web app runs on http://localhost:5180 and the API on http://localhost:4100. Mailpit, which catches outgoing email, runs on http://localhost:8025.

## Tests

Tests run against their own database, so they never touch your development data. Create it once, and again after adding migrations:

```bash
pnpm test:setup
pnpm test
```

Test packages run one at a time because they share that database.

## Production image

One `Dockerfile` builds three targets: `api` (also serves the web app), `worker` (with ClamAV inside) and `migrate`. See `docs/runbook.md` for deploying to Scaleway, `docs/hardening-report.md` for the launch checks, and `docs/pilot-onboarding.md` for bringing a firm on.

```bash
docker build --target api -t kleidi-api .
```

## Checks

```bash
pnpm format:check && pnpm lint && pnpm boundaries && pnpm typecheck && pnpm test && pnpm build
```

The database tests in `packages/db/test` prove row-level security: a firm sees only its own rows, cannot write rows for another firm, and cannot edit the audit trail. They run whenever `DATABASE_URL` is set.

## How it fits together

- **Tenancy:** every firm-owned row has `firm_id`. Code reads and writes through `withFirm(db, firmId, fn)`, which sets `app.firm_id` for the transaction. Postgres row-level security does the filtering.
- **Two database roles:** `kleidi_admin` owns the schema and runs migrations. `kleidi_app` is what the API and worker use, and row-level security applies to it.
- **Jurisdictions are data:** stages and document requirements live in `stage_templates` and `document_requirements`. A new country is new seed data, not new code.
- **Events and the outbox:** commands publish domain events in the same transaction as their change. The worker relays the outbox to a pg-boss queue per consumer; consumers record each event they handle, so redelivery is harmless. The audit trail is built from these events.
- **Cases:** `cases/domain.ts` is a pure state machine over the jurisdiction's stages, covered by property tests. References such as `CY-2026-007` come from a per-firm, per-year counter.
- **Safe writes:** case writes need `If-Match: "v<version>"`, and a stale version gets 412. POST requests may send an `Idempotency-Key`; a repeat within 24 hours replays the first response, and the same key with a different body gets 422.
- **Documents:** the browser uploads straight to object storage with a 15-minute signed link, into `quarantine/`. The worker streams each file to ClamAV. A clean file moves to `firms/<firm>/cases/<case>/` and can be downloaded through a 5-minute link; an infected file never leaves quarantine. Every upload is a new version, and documents are firm-only until a lawyer shares them.
- **Deadlines and notifications:** the worker checks every 15 minutes for reminders that are due. It records each reminder as sent in the same transaction as its event, so a restart never announces one twice. Each email or SMS gets a row with a unique key before it is sent, and a retried job skips messages already sent. Messages go out in the recipient's saved language. A digest goes to each member at 07:00 Cyprus time. Brevo sends email and SMS when `BREVO_API_KEY` is set; otherwise both land in Mailpit, with SMS shown as an email to `sms+<number>@kleidi.local`.
- **Client portal:** buyers and sellers are not firm users. A lawyer invites a case party, who gets an emailed link; opening it texts a 6-digit code to their phone, and both are needed to start a 7-day session held in an `HttpOnly` cookie scoped to `/api/portal`. Portal routes return only documents shared with the client or requested from them, plus the client's own uploads. Anything else answers "not found". A client's upload waits for the firm to accept it or ask for a new one; the firm's own files count as done after the virus scan. The client accepts the privacy notice before seeing their case, and can let their agent, bank or insurer follow it; both are recorded.
- **Errors:** every user-facing error carries a `messageKey`, which the web app translates; the English `title` is the fallback.
- **Identity:** Better Auth with email and password and authenticator-app two-factor sign-in, mounted at `/api/auth`. The web app talks to the API through the Vite proxy, so cookies stay first-party.
- **No build step for Node apps:** the API and worker run TypeScript directly with Node's type stripping, so imports use `.ts` extensions and only erasable syntax is allowed.
