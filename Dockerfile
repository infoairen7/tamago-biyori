# フロントエンドとランキングサーバーを1つのNode.jsプロセスで同じオリジンから配信するイメージ
# docker build -t tamago-biyori . && docker run -p 8787:8787 -v tamago-data:/app/data tamago-biyori

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN VITE_API_BASE=/ npx vite build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DB_PATH=/app/data/tamago.sqlite STATIC_DIR=/app/dist
COPY package.json ./
COPY config ./config
COPY shared ./shared
COPY server ./server
COPY scripts/start.ts ./scripts/start.ts
COPY --from=build /app/dist ./dist
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
