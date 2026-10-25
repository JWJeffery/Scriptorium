# One image runs both the web server and the background worker (they differ only in the command).
# Debian (glibc), not Alpine: the PDF renderer (@napi-rs/canvas) and the search model runtime need glibc.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /app

FROM base AS build
# Dependencies first, so a code-only change reuses the cached install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY prisma prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma:generate
# The build needs no database; this placeholder only satisfies tools that insist on a value.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# The worker runs TypeScript directly (tsx), so the source and dev dependencies stay in the image.
COPY --from=build --chown=node:node /app /app
# Uploaded files, backups and the search model live under /data (a volume). It must belong to the app's
# user BEFORE the volume is first used, or the app cannot write there.
RUN mkdir -p /data/storage /data/backups /data/models && chown -R node:node /data
USER node
WORKDIR /app/apps/web
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
