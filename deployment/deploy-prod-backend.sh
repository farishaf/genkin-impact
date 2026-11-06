#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deployment"
COMPOSE_FILE="docker-compose-deploy-prod-backend.yml"

[ -f "$DEPLOY_DIR/.env" ] || { echo "Missing deployment/.env — copy .env.example and fill it in first."; exit 1; }
# shellcheck disable=SC1091
source "$DEPLOY_DIR/.env"
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-prod"

BRANCH="${BRANCH:-main}"

echo "Deploying ${PROJECT_NAME:-project} [prod] backend..."

[ -f "$ROOT_DIR/$BACKEND_DIR/.env" ] || { echo "Missing $BACKEND_DIR/.env — copy .env.example and fill it in first."; exit 1; }

docker network create "${PROJECT_NAME}-prod-net" 2>/dev/null || true

git -C "$ROOT_DIR/$BACKEND_DIR" pull origin "$BRANCH"

cd "$DEPLOY_DIR"
docker compose -f "$COMPOSE_FILE" down
docker compose -f "$COMPOSE_FILE" up -d --build

echo "Backend (prod) deployment done."
