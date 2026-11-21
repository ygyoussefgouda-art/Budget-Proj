# syntax=docker/dockerfile:1
# Budget me: React web app + Node API in one small image.

# ---- build the React app ----
FROM node:22-alpine AS web
WORKDIR /src/web
# package-lock.json is optional: copied when present (npm install then honours it)
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- build the API ----
FROM node:22-alpine AS server
WORKDIR /src/server
COPY server/package*.json ./
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=server /src/server/package.json ./
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/dist ./dist
COPY server/migrations ./migrations
COPY --from=web /src/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
