#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deployment"
COMPOSE_FILE="docker-compose-deploy-prod-db.yml"

[ -f "$DEPLOY_DIR/.env" ] || { echo "Missing deployment/.env — copy .env.example and fill it in first."; exit 1; }
# shellcheck disable=SC1091
source "$DEPLOY_DIR/.env"
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-prod"

[ -f "$DEPLOY_DIR/.env.prod.db" ] || { echo "Missing deployment/.env.prod.db"; exit 1; }

echo "Deploying ${PROJECT_NAME:-project} [prod] db..."
docker network create "${PROJECT_NAME}-prod-net" 2>/dev/null || true

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" up -d

echo "DB (prod) deployment done."
