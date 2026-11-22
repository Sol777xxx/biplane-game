# syntax=docker/dockerfile:1

# ---------- етап 1: збірка клієнта ----------
# Тут є dev-залежності (vite). Цей етап у фінальний образ не потрапляє, звідти їде лише client/dist.
FROM node:24-alpine AS build
WORKDIR /app

# Спершу лише маніфести: шар із npm ci перезбирається, лише коли змінились залежності.
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN npm run build -w client

# ---------- етап 2: фінальний образ ----------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
# Лише залежності сервера (ws, pino, zod). vite, vitest, biome, playwright сюди не потрапляють.
RUN npm ci --omit=dev -w server && npm cache clean --force

# Сервер запускає TypeScript напряму (Node 24), тож збирати його не потрібно.
COPY shared shared
COPY server/src server/src
COPY --from=build /app/client/dist client/dist

# Логи матчів пишуться на диск: директорія має належати користувачу node, не root.
RUN mkdir -p /app/logs && chown node:node /app/logs

# git SHA збірки: CI передає --build-arg GIT_SHA=<sha коміту>, /health показує його.
# Цей шар іде останнім, щоб різні SHA не інвалідували кеш попередніх.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_DIR=/app/logs

USER node
EXPOSE 3000

# /health відповідає, поки процес живий. wget є в alpine (busybox), curl не потрібен.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# Саме node і файл, не npm start: npm не передає SIGTERM дочірньому процесу,
# і docker stop через 10 с вбив би гру через SIGKILL без graceful shutdown.
CMD ["node", "server/src/index.ts"]
