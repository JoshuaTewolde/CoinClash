# CoinClash production image: one Node process serves the API, Socket.IO and the built web app.
# Caddy (docker-compose.yml) terminates TLS in front of it.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@9.15.9
COPY . .
RUN pnpm install --frozen-lockfile
# VITE_* values are PUBLIC (baked into the browser bundle).
ARG VITE_BREEZ_API_KEY
ARG VITE_PASSKEY_RP_ID=coinclash.vip
ARG VITE_PASSKEY_RP_NAME=CoinClash
ARG VITE_REGTEST_FAUCET_URL=https://app.lightspark.com/regtest-faucet
ENV VITE_BREEZ_API_KEY=$VITE_BREEZ_API_KEY \
    VITE_PASSKEY_RP_ID=$VITE_PASSKEY_RP_ID \
    VITE_PASSKEY_RP_NAME=$VITE_PASSKEY_RP_NAME \
    VITE_REGTEST_FAUCET_URL=$VITE_REGTEST_FAUCET_URL
RUN pnpm --filter @coinclash/web build && pnpm --filter @coinclash/server build
# Production-only node_modules for the server (workspace packages are bundled by tsup).
RUN pnpm --filter @coinclash/server deploy --prod /out

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production WEB_DIST_DIR=/app/web BREEZ_STORAGE_DIR=/data/breez PORT=8787
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
