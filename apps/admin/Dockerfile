# ErrandCONNECT admin panel. Build from the repository root:
#   docker build -f apps/admin/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.errandconnect.co.ke -t errandconnect-admin .
FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g npm@11 --no-fund --no-audit
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/admin/package.json ./apps/admin/
COPY apps/api/package.json ./apps/api/
RUN npm ci -w @errandconnect/admin -w @errandconnect/shared --include-workspace-root --no-fund --no-audit
COPY apps/admin ./apps/admin
# Baked into the browser code at build time.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @errandconnect/admin

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public ./apps/admin/public
USER node
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
