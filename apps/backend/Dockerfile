# syntax=docker/dockerfile:1
#
# Backend image. Bun runs TypeScript directly, so "build" = install workspace
# deps. Build context = repo root (monorepo). This image is API + WebSocket
# only — Caddy serves the front (apps/web is NOT copied here).

FROM oven/bun:1.2.20-alpine AS base
WORKDIR /app

# ---- deps: install workspace deps; layer cached on manifests + lockfile ----
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/data/package.json packages/data/
COPY packages/db/package.json packages/db/
COPY apps/backend/package.json apps/backend/
COPY apps/web/package.json apps/web/
COPY strategies/package.json strategies/
RUN bun install --frozen-lockfile

# ---- development: hot-reload (used by ops/docker-compose.dev.yml) ----
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["bun", "--watch", "apps/backend/src/index.ts"]

# ---- runtime: built + pushed to GHCR by CI ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY packages ./packages
COPY strategies ./strategies
COPY apps/backend ./apps/backend
EXPOSE 3001
CMD ["bun", "apps/backend/src/index.ts"]
