# Audion API for Cloud Run. Build from the REPO ROOT (the workspace needs packages/shared):
#   docker build -f apps/api/Dockerfile -t audion-api .
# It also builds and serves the public web demo (apps/extension, web/), so one Cloud Run service is the whole site.
# Runs as a non-root user, listens on $PORT (Cloud Run sets it), holds no secrets and no credentials:
# Google access comes from the Cloud Run service account via Application Default Credentials.

FROM node:22-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo

# Install first (cached unless manifests change).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@audion/api..."

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @audion/shared build \
 && pnpm --filter @audion/api build \
 && pnpm --filter @audion/api deploy --legacy --prod /out

# The public web demo: the same panel as the extension, built as a plain website.
FROM node:22-slim AS web
ENV CI=true
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/extension/package.json apps/extension/
RUN pnpm install --frozen-lockfile --filter "@audion/extension..."
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/extension apps/extension
RUN pnpm --filter @audion/shared build \
 && pnpm --filter @audion/extension exec wxt prepare \
 && pnpm --filter @audion/extension build:web

FROM node:22-slim
ENV NODE_ENV=production WEB_DIR=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
COPY --from=web --chown=node:node /repo/apps/extension/dist-web/ ./web/
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
