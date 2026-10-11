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

Open http://localhost:5180, create an account and set up an authenticator app. Invitation and reminder emails land in Mailpit at http://localhost:8025.

The web app runs on http://localhost:5180 and the API on http://localhost:4100. Mailpit, which catches outgoing email, runs on http://localhost:8025.

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
- **Identity:** Better Auth with email and password and authenticator-app two-factor sign-in, mounted at `/api/auth`. The web app talks to the API through the Vite proxy, so cookies stay first-party.
- **No build step for Node apps:** the API and worker run TypeScript directly with Node's type stripping, so imports use `.ts` extensions and only erasable syntax is allowed.
