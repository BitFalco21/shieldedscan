# The read-only explorer API and the cross-chain ingest poller.
#
# The bundle is self-contained (esbuild inlines hono and the parsers), so the runtime stage
# carries no node_modules.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY server ./server
COPY scripts/bundle.mjs ./scripts/bundle.mjs
RUN npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/server.mjs ./server.mjs
# Applied idempotently on boot, so a fresh database needs no manual migration step.
COPY --from=build /app/server/schema.sql ./schema.sql

# Never run as root; the process needs nothing but outbound HTTPS.
USER node
EXPOSE 8080

# Dormant venues report healthy: a pool with no ZEC swaps is not an outage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
