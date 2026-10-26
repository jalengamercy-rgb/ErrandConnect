# ErrandCONNECT API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t errandconnect-api .
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g npm@11 --no-fund --no-audit
# Workspace manifests first so dependency installs are cached between code changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
RUN npm ci -w @errandconnect/api -w @errandconnect/shared --include-workspace-root --no-fund --no-audit
COPY apps/api ./apps/api
RUN npm run build -w @errandconnect/api

# Runs database migrations (use as a one-off job before starting a new version).
FROM build AS migrate
WORKDIR /app/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g npm@11 --no-fund --no-audit
COPY package.json package-lock.json tsconfig.base.json ./
COPY --from=build /app/packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
RUN npm ci -w @errandconnect/api -w @errandconnect/shared --omit=dev --ignore-scripts --no-fund --no-audit && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
# Uploaded documents (mount a volume here, or switch to object storage).
RUN mkdir -p /data/uploads && chown node:node /data/uploads
ENV STORAGE_DIR=/data/uploads PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
