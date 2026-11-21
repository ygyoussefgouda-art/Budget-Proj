# syntax=docker/dockerfile:1
# Budget me: React web app + Node API in one small image.

# ---- build the React app ----
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
# npm ci installs exactly what the lockfile says (reproducible, no surprise upgrades)
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- build the API ----
FROM node:22-alpine AS server
WORKDIR /src/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime: only the compiled app and production dependencies ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=server --chown=root:root /src/server/package.json ./
COPY --from=server --chown=root:root /src/server/node_modules ./node_modules
COPY --from=server --chown=root:root /src/server/dist ./dist
COPY --chown=root:root server/migrations ./migrations
COPY --from=web --chown=root:root /src/web/dist ./public
# Runs as the unprivileged "node" user; the app files belong to root, so the app cannot modify itself.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
