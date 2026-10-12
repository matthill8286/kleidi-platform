#!/bin/sh
# Keep the baked-in virus signatures fresh, start clamd, then the worker.
set -e
freshclam -d --checks=12
clamd
exec su node -s /bin/sh -c "cd /app/apps/worker && exec node src/index.ts"
