import { FIRM_SCOPED_TABLES } from "./schema/index.ts";

export const APP_ROLE = process.env.DATABASE_APP_ROLE ?? "kleidi_app";

const firmMatch = "firm_id = nullif(current_setting('app.firm_id', true), '')::uuid";

/** Idempotent SQL run after every migration: grants, row-level security and the audit guard. */
export function policiesSql(role = APP_ROLE): string {
  const rls = FIRM_SCOPED_TABLES.map(
    (table) => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_isolation ON ${table};
CREATE POLICY firm_isolation ON ${table} USING (${firmMatch}) WITH CHECK (${firmMatch});`,
  ).join("\n");

  return `
GRANT USAGE ON SCHEMA public TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
GRANT SELECT ON jurisdictions, stage_templates, document_requirements TO ${role};
REVOKE INSERT, UPDATE, DELETE ON jurisdictions, stage_templates, document_requirements FROM ${role};
REVOKE UPDATE, DELETE ON audit_events FROM ${role};

CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${role};
${rls}

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
`;
}
