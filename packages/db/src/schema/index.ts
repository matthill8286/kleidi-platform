export * from "./columns.ts";
export * from "./jurisdictions.ts";
export * from "./identity.ts";
export * from "./firms.ts";
export * from "./cases.ts";
export * from "./documents.ts";
export * from "./deadlines.ts";
export * from "./consent.ts";
export * from "./notifications.ts";
export * from "./audit.ts";
export * from "./events.ts";
export * from "./idempotency.ts";

/**
 * Tables filtered by row-level security on firm_id; policies.ts builds its SQL from this list.
 * Left unscoped on purpose: firms, firm_members and firm_invitations (login and invitations
 * resolve firms before one is selected), identity tables, and the outbox (relayed across firms).
 */
export const FIRM_SCOPED_TABLES = [
  "cases",
  "case_counters",
  "case_parties",
  "case_stages",
  "documents",
  "document_versions",
  "deadlines",
  "consents",
  "notifications",
  "audit_events",
] as const;
