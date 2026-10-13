#!/bin/sh
# Dumps the database every night at 02:00 server time and keeps the last 14 dumps.
set -e
while true; do
  now=$(date +%s)
  next=$(date -d "$(date -d @$((now + 86400)) +%Y-%m-%d) 02:00" +%s)
  [ "$(date +%H)" -lt 2 ] && next=$(date -d "$(date +%Y-%m-%d) 02:00" +%s)
  sleep $((next - now))
  file="/backups/kleidi-$(date +%Y-%m-%d).dump"
  pg_dump -h postgres -U kleidi_admin -d kleidi -Fc -f "$file.tmp" && mv "$file.tmp" "$file"
  echo "backup written: $file"
  ls -1t /backups/kleidi-*.dump | tail -n +15 | xargs -r rm -f
done
