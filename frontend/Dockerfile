# syntax=docker/dockerfile:1.7

##
# Frontend (Next.js) production image.
# - Multi-stage build
# - Traced standalone runtime plus minimal DB migration dependencies
# - Includes DB migrations runner + SQL migrations
##

FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Install dependencies using pnpm (via Corepack).
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Only copy what we need to install deps (better layer caching).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY xlsx-0.20.3.tgz ./xlsx-0.20.3.tgz

RUN pnpm install --frozen-lockfile


FROM deps AS prod-deps
# Drop devDependencies for the runtime image.
RUN pnpm prune --prod

# The standalone server contains only dependencies traced from the app. The
# migration script is not part of that trace, so stage its two small packages
# separately for the runtime image.
FROM prod-deps AS migration-deps
RUN mkdir -p /migration-node_modules \
  && cp -LR node_modules/drizzle-orm /migration-node_modules/drizzle-orm \
  && cp -LR node_modules/postgres /migration-node_modules/postgres


FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next build evaluates some server files at build time; provide safe defaults.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
ENV APP_URL="http://localhost:8080"
ENV BETTER_AUTH_URL="http://localhost:8080"
ENV BETTER_AUTH_SECRET="build-only-secret"

# Build-time public flags (inlined into the JS bundle by Next.js).

ARG NEXT_PUBLIC_DEMO_EMAIL=""
ENV NEXT_PUBLIC_DEMO_EMAIL=$NEXT_PUBLIC_DEMO_EMAIL

ARG NEXT_PUBLIC_DEMO_PASSWORD=""
ENV NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD

RUN pnpm build


FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Use Next.js' traced standalone server instead of the complete production
# dependency tree.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Minimal dependencies used only by scripts/migrate.js.
COPY --from=migration-deps --chown=node:node /migration-node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=migration-deps --chown=node:node /migration-node_modules/postgres ./node_modules/postgres

# Migration runner + SQL migrations (used by docker-compose one-shot "migrate" service)
COPY --from=builder --chown=node:node /app/scripts/migrate.js ./scripts/migrate.js
COPY --from=builder --chown=node:node /app/lib/db/migrations ./lib/db/migrations

# Uploads live on a persistent volume in production (LOCAL_STORAGE_PATH,
# typically /data/uploads) and are served via the /uploads/* route handler,
# not the public/ directory. No build-time mkdir needed — the storage
# provider creates its root on first write.

USER node

EXPOSE 3000
# Migrations are owned by the one-shot "migrate" Compose service (which
# overrides this CMD with `node scripts/migrate.js`); the "app" service
# waits on it via depends_on/service_completed_successfully and just runs
# the server. Running migrate.js again here would re-apply it on every
# "app" start and race the migrate service the moment this scales past one
# replica.
CMD ["node", "server.js"]
