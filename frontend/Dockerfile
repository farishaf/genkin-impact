# Vite inlines VITE_* at build time. The bundle calls /api, which nginx
# proxies to the backend container — same origin, so cookies just work.
FROM node:22-alpine AS builder
WORKDIR /app
ENV VITE_API_URL=/api

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
# nginx image runs envsubst on /etc/nginx/templates/* at startup
ARG BACKEND_ORIGIN
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000
