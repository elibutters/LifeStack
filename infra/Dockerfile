# One image for all services; Compose picks the command.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/workers/package.json apps/workers/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @lifestack/web build

USER node
