#!/usr/bin/env bash
# Restore drill: back up the database, restore it into a fresh one, and prove the copy works.
# Locally it uses the docker compose Postgres; in production point PGHOST/PGUSER/PGPASSWORD at
# the managed instance and run it against a restored snapshot instead.
set -euo pipefail

SOURCE="${SOURCE_DB:-kleidi}"
TARGET="kleidi_restore_drill"
PG="docker compose exec -T postgres"
dump="$(mktemp -t kleidi-backup).dump"
started=$(date +%s)

echo "1. Backing up $SOURCE"
$PG pg_dump -U kleidi_admin -d "$SOURCE" -Fc > "$dump"
echo "   $(du -h "$dump" | cut -f1) written"

echo "2. Restoring into $TARGET"
$PG psql -U kleidi_admin -d postgres -qc "DROP DATABASE IF EXISTS $TARGET" -c "CREATE DATABASE $TARGET"
$PG pg_restore -U kleidi_admin -d "$TARGET" --no-owner --role=kleidi_admin < "$dump"
$PG psql -U kleidi_admin -d "$TARGET" -qc "GRANT CONNECT ON DATABASE $TARGET TO kleidi_app"

echo "3. Comparing row counts"
tables="users firms cases case_parties documents document_versions deadlines audit_events portal_access consents"
failed=0
for t in $tables; do
  a=$($PG psql -U kleidi_admin -d "$SOURCE" -Atc "SELECT count(*) FROM $t")
  b=$($PG psql -U kleidi_admin -d "$TARGET" -Atc "SELECT count(*) FROM $t")
  printf "   %-18s %8s %8s %s\n" "$t" "$a" "$b" "$([ "$a" = "$b" ] && echo ok || echo MISMATCH)"
  [ "$a" = "$b" ] || failed=1
done

echo "4. Checking the safeguards came back"
rls=$($PG psql -U kleidi_admin -d "$TARGET" -Atc \
  "SELECT count(*) FROM pg_class WHERE relname IN ('cases','documents','audit_events','portal_access') AND relrowsecurity")
echo "   row-level security on key tables: $rls of 4"; [ "$rls" = 4 ] || failed=1
trigger=$($PG psql -U kleidi_admin -d "$TARGET" -Atc \
  "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal")
echo "   append-only trigger on audit_events: $trigger"; [ "$trigger" -ge 1 ] || failed=1
# The app role must see nothing without a firm set, exactly as in the live database.
leak=$($PG psql "postgres://kleidi_app:kleidi_app@localhost:5432/$TARGET" -Atc "SELECT count(*) FROM cases")
echo "   cases visible to the app role with no firm set: $leak"; [ "$leak" = 0 ] || failed=1

echo "5. Cleaning up"
$PG psql -U kleidi_admin -d postgres -qc "DROP DATABASE $TARGET"
rm -f "$dump"

echo "Restore drill took $(( $(date +%s) - started )) seconds."
if [ "$failed" = 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; exit 1; fi
