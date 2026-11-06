#!/bin/bash
set -e

usage() {
  echo "Usage: ./logs.sh <staging|prod> <db|backend|frontend> [-- extra docker compose logs args]"
  echo "Examples:"
  echo "  ./logs.sh staging backend              # follow, tail 200"
  echo "  ./logs.sh prod frontend -- --tail=50    # override tail"
  echo "  ./logs.sh staging db -- --no-follow     # just dump, don't follow"
  exit 1
}

ENV="$1"
SERVICE="$2"
shift 2 2>/dev/null || true
EXTRA_ARGS=()
if [ "$1" = "--" ]; then
  shift
  EXTRA_ARGS=("$@")
fi

[ -n "$ENV" ] && [ -n "$SERVICE" ] || usage
case "$ENV" in staging|prod) ;; *) usage ;; esac
case "$SERVICE" in db|backend|frontend) ;; *) usage ;; esac

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="docker-compose-deploy-${ENV}-${SERVICE}.yml"
[ -f "$DEPLOY_DIR/$COMPOSE_FILE" ] || { echo "No such compose file: $COMPOSE_FILE"; exit 1; }

# match the project name the deploy scripts use, or compose finds no containers
# shellcheck disable=SC1091
source "$DEPLOY_DIR/.env"
export COMPOSE_PROJECT_NAME="${PROJECT_NAME}-${ENV}"

cd "$DEPLOY_DIR"
if [ "${#EXTRA_ARGS[@]}" -eq 0 ]; then
  docker compose -f "$COMPOSE_FILE" logs -f --tail=200 "$SERVICE"
else
  docker compose -f "$COMPOSE_FILE" logs "${EXTRA_ARGS[@]}" "$SERVICE"
fi
