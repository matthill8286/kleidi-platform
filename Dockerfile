# One image recipe, three targets: api (also serves the web app), worker and migrate.
# Node runs the TypeScript directly, so the runtime keeps the workspace layout.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @kleidi/web exec tsr generate \
 && pnpm --filter @kleidi/web build

FROM base AS runtime
COPY . .
RUN pnpm install --frozen-lockfile --prod \
 && rm -rf apps/web/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
ENV NODE_ENV=production
USER node

FROM runtime AS api
ENV WEB_DIST=/app/apps/web/dist API_PORT=8080
EXPOSE 8080
WORKDIR /app/apps/api
CMD ["node", "src/index.ts"]

# The worker carries its own ClamAV: serverless containers only take HTTP, so a separate
# scanner service could not be reached. The entrypoint starts freshclam and clamd first.
FROM runtime AS worker
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates clamav-daemon clamav-freshclam \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /run/clamav && chown clamav:clamav /run/clamav \
 && sed -i 's/^#\?TCPSocket .*/TCPSocket 3310/; s/^#\?TCPAddr .*/TCPAddr 127.0.0.1/' /etc/clamav/clamd.conf \
 && grep -q '^TCPSocket' /etc/clamav/clamd.conf || printf 'TCPSocket 3310\nTCPAddr 127.0.0.1\n' >> /etc/clamav/clamd.conf
# Signatures are baked in, so a new container scans at once; freshclam refreshes them later.
RUN freshclam --stdout && chown -R clamav:clamav /var/lib/clamav
COPY infra/docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint
ENV CLAMD_HOST=127.0.0.1 CLAMD_PORT=3310 PORT=8080
WORKDIR /app/apps/worker
CMD ["worker-entrypoint"]

# Runs once per release, before the new api and worker start: migrations and policies, then
# the reference data (countries, stages, checklists), which skips rows already there.
FROM runtime AS migrate
WORKDIR /app/packages/db
CMD ["sh", "-c", "node src/migrate.ts && node src/seed.ts"]
