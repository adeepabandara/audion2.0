# Audion API for Cloud Run. Build from the REPO ROOT (the workspace needs packages/shared):
#   docker build -f apps/api/Dockerfile -t audion-api .
# Runs as a non-root user, listens on $PORT (Cloud Run sets it), holds no secrets and no credentials:
# Google access comes from the Cloud Run service account via Application Default Credentials.

FROM node:20-slim AS build
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

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
