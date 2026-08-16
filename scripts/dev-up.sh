#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="local"

usage() {
  cat <<'EOF'
Usage: dev-up.sh [--local|--prebuilt]

  --local     Start the full Docker local development stack (default).
  --prebuilt  Pull GHCR images via deploy/compose.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --local)
      MODE="local"
      ;;
    --prebuilt)
      MODE="prebuilt"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      usage
      exit 1
      ;;
  esac
done

if [ "$MODE" = "prebuilt" ]; then
  ENV_FILE="$ROOT_DIR/deploy/compose/.env"
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE."
    echo "Copy deploy/compose/.env.example to deploy/compose/.env and edit it first."
    exit 1
  fi

  echo "Pulling prebuilt images (GHCR)..."
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/deploy/compose/docker-compose.yml" pull
  echo "Starting prebuilt stack..."
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/deploy/compose/docker-compose.yml" up -d
  echo "Done."
  exit 0
fi

# Local mode - uses development defaults from docker-compose.yml
ENV_COMPOSE_FILE="$ROOT_DIR/deploy/compose/.env"

if [ -f "$ENV_COMPOSE_FILE" ]; then
  compose_args=(--env-file "$ENV_COMPOSE_FILE")
fi

echo "Starting local development stack..."
if [ -f "$ENV_COMPOSE_FILE" ]; then
  docker compose "${compose_args[@]}" -f "$ROOT_DIR/docker-compose.yml" up -d --build
else
  docker compose -f "$ROOT_DIR/docker-compose.yml" up -d --build
fi

echo ""
echo "Done."
echo ""
echo "Open http://localhost:3000"
echo "Backend API: http://localhost:8000"
echo ""
echo "Logs: docker compose -f docker-compose.yml logs -f frontend backend"
