#!/bin/sh
# First start only: the app connects as this non-owner role, so row-level security applies.
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_password="$KLEIDI_APP_PASSWORD" <<'SQL'
CREATE ROLE kleidi_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE kleidi TO kleidi_app;
SQL
