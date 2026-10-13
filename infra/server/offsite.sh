#!/bin/sh
# Every night at 03:00, after the 02:00 dump: copy dumps and documents to the backup bucket.
if [ -z "$BACKUP_BUCKET" ]; then
  echo "No BACKUP_BUCKET set: offsite copies are off."
  exec sleep infinity
fi
while true; do
  now=$(date +%s)
  next=$(date -d "$(date -d @$((now + 86400)) +%Y-%m-%d) 03:00" +%s)
  [ "$(date +%H)" -lt 3 ] && next=$(date -d "$(date +%Y-%m-%d) 03:00" +%s)
  sleep $((next - now))
  rclone copy /backups "remote:$BACKUP_BUCKET/database" --include "kleidi-*.dump" &&
    rclone sync local:kleidi-documents "remote:$BACKUP_BUCKET/documents" &&
    echo "offsite copy finished $(date -Iseconds)"
done
