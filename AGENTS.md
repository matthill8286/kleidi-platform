# Kleidi platform

- pnpm workspaces + Turborepo. Do not introduce Next.js.
- Node apps run TypeScript directly (Node 24 type stripping): use `.ts` import extensions, no enums, namespaces or parameter properties.
- Business code lives in `packages/modules/src/<module>/`. A module uses another module only through its `index.ts`, imports only its own schema file (`@kleidi/db/schema/<module>`), and keeps `domain.ts` free of I/O. `pnpm boundaries` enforces this in CI.
- Read and write firm data only inside `withFirm(db, firmId, fn)` from `@kleidi/db`. Never use `DATABASE_ADMIN_URL` outside migrations, seeding and tests.
- A new firm-scoped table needs `firm_id` and an entry in `FIRM_SCOPED_TABLES`; the RLS test fails otherwise.
- State changes publish domain events with `publishEvents(tx, events)` in the same transaction. Side effects in other modules (audit, email) are event consumers in `apps/worker/src/consumers.ts`, wrapped in `handleOnce` so redelivery is safe.
- `audit_events` is append-only and is written only by the audit consumer. Never put secrets (tokens) in audit metadata.
- Firm users must have two-factor sign-in on; the API returns `two_factor_required` otherwise.
- Every user-facing string goes in all three locale files in `packages/i18n`; a test checks the keys match. Greek and Russian strings are drafts pending professional translation.
- Buyers must never receive documents with `visibility = firm`.
- Local ports: Postgres 5434, API 4100, web 5180, SeaweedFS (S3) 8333, Mailpit 1025/8025.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
