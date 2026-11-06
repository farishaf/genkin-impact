FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# migrate.js reads SQL from ../../migrations relative to dist/db
COPY migrations ./migrations

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && mkdir -p uploads

EXPOSE 4000

ENTRYPOINT ["./entrypoint.sh"]
