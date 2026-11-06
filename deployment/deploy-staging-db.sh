#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deployment"
COMPOSE_FILE="docker-compose-deploy-staging-db.yml"

[ -f "$DEPLOY_DIR/.env" ] || { echo "Missing deployment/.env — copy .env.example and fill it in first."; exit 1; }
# shellcheck disable=SC1091
source "$DEPLOY_DIR/.env"
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-staging"

[ -f "$DEPLOY_DIR/.env.staging.db" ] || { echo "Missing deployment/.env.staging.db"; exit 1; }

echo "Deploying ${PROJECT_NAME:-project} [staging] db..."
docker network create "${PROJECT_NAME}-staging-net" 2>/dev/null || true

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" up -d

echo "DB (staging) deployment done."
