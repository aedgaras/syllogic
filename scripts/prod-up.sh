#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/compose/.env"

usage() {
  cat <<'EOF'
Usage: prod-up.sh [--local] [--lite] [--caddy]

Options:
  --local  Build production images from the current checkout instead of GHCR
  --lite  Use the resource-constrained single-host stack (no separate Beat or MCP)
  --caddy  Enable the optional Caddy reverse proxy
EOF
}

MODE="full"
SOURCE="prebuilt"
ENABLE_CADDY="false"

for arg in "$@"; do
  case "$arg" in
    --local)
      SOURCE="local"
      ;;
    --lite)
      MODE="lite"
      ;;
    --caddy)
      ENABLE_CADDY="true"
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

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]'
}

ensure_secret() {
  local name="$1"
  local current_value
  local generated_value
  local temp_file

  current_value="$(sed -n "s/^[[:space:]]*$name[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | tr -d '\r')"
  if [ -n "$current_value" ] && [ "$current_value" != "change-me" ]; then
    return
  fi

  generated_value="$(generate_secret)"
  temp_file="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v name="$name" -v value="$generated_value" '
    BEGIN { written = 0 }
    $0 ~ "^[[:space:]#]*" name "[[:space:]]*=" {
      if (!written) {
        print name "=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) print name "=" value
    }
  ' "$ENV_FILE" > "$temp_file"
  mv "$temp_file" "$ENV_FILE"
}

read_setting() {
  local name="$1"
  sed -n "s/^[[:space:]]*$name[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

ensure_setting() {
  local name="$1"
  local value="$2"

  if [ -n "$(read_setting "$name")" ]; then
    return
  fi
  printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
}

initialize_local_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ROOT_DIR/deploy/compose/.env.example" "$ENV_FILE"
    echo "Created deploy/compose/.env from the local production defaults."
  fi

  ensure_setting APP_URL "http://localhost:8080"
  ensure_setting APP_PORT "8080"
  ensure_setting CADDY_ADDRESS ":80"
  ensure_setting HTTP_PORT "80"
  ensure_setting POSTGRES_IMAGE "postgres:16-alpine"
  ensure_setting POSTGRES_USER "financeuser"
  ensure_setting POSTGRES_DB "finance_db"
  ensure_secret POSTGRES_PASSWORD
  ensure_secret BETTER_AUTH_SECRET
  ensure_secret INTERNAL_AUTH_SECRET
  ensure_secret DATA_ENCRYPTION_KEY_CURRENT
  ensure_setting DATABASE_URL "postgresql://$(read_setting POSTGRES_USER):$(read_setting POSTGRES_PASSWORD)@postgres:5432/$(read_setting POSTGRES_DB)"
  ensure_setting REDIS_URL "redis://redis:6379/0"
  ensure_setting BACKEND_URL "http://backend:8000"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

if [ "$SOURCE" = "local" ]; then
  initialize_local_env
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE."
  echo "Copy deploy/compose/.env.example to deploy/compose/.env and edit it first."
  exit 1
fi

if [ "$ENABLE_CADDY" = "true" ]; then
  APP_PORT_VALUE="$(read_setting APP_PORT)"
  HTTP_PORT_VALUE="$(read_setting HTTP_PORT)"
  HTTPS_PORT_VALUE="$(read_setting HTTPS_PORT)"
  APP_PORT_VALUE="${APP_PORT_VALUE:-8080}"
  HTTP_PORT_VALUE="${HTTP_PORT_VALUE:-80}"
  HTTPS_PORT_VALUE="${HTTPS_PORT_VALUE:-443}"
  if [ "$APP_PORT_VALUE" = "$HTTP_PORT_VALUE" ] || [ "$APP_PORT_VALUE" = "$HTTPS_PORT_VALUE" ]; then
    echo "APP_PORT ($APP_PORT_VALUE) conflicts with a Caddy host port."
    echo "Set APP_PORT, HTTP_PORT, and HTTPS_PORT to distinct values in $ENV_FILE."
    exit 1
  fi
fi

if ! docker version >/dev/null 2>&1; then
  echo "Docker is not installed or is not running. Start Docker and try again."
  exit 1
fi

APP_VERSION_VALUE="$(grep -E '^APP_VERSION=' "$ENV_FILE" | tail -n1 | cut -d'=' -f2- || true)"
if [ "$SOURCE" = "prebuilt" ] && [ "${APP_VERSION_VALUE:-edge}" = "edge" ]; then
  echo "WARNING: APP_VERSION=edge is intended for development/testing."
  echo "For production, pin APP_VERSION to a release tag (for example vX.Y.Z)."
fi

COMPOSE_ARGS=(
  --env-file "$ENV_FILE"
  -f "$ROOT_DIR/deploy/compose/docker-compose.yml"
)
if [ "$ENABLE_CADDY" = "true" ]; then
  COMPOSE_ARGS+=(--profile caddy)
fi
if [ "$SOURCE" = "local" ]; then
  COMPOSE_ARGS+=(-f "$ROOT_DIR/deploy/compose/docker-compose.local.yml")
fi
SERVICES=()
if [ "$MODE" = "lite" ]; then
  COMPOSE_ARGS+=(-f "$ROOT_DIR/deploy/compose/docker-compose.lite.yml")
  SERVICES=(postgres redis uploads-init migrate backend worker app)
  if [ "$ENABLE_CADDY" = "true" ]; then
    SERVICES+=(caddy)
  fi
fi

if [ "$SOURCE" = "prebuilt" ]; then
  echo "Pulling prebuilt images (GHCR) for $MODE mode..."
  docker compose "${COMPOSE_ARGS[@]}" pull "${SERVICES[@]}"
fi

if [ "$MODE" = "lite" ]; then
  # Prevent duplicate schedules and retain the lite memory target when
  # switching an existing full installation to lite mode.
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/deploy/compose/docker-compose.yml" rm -s -f beat mcp
fi

echo "Starting production stack in $MODE mode from $SOURCE images..."
UP_ARGS=(up -d)
if [ "$SOURCE" = "local" ]; then
  UP_ARGS+=(--build)
fi
docker compose "${COMPOSE_ARGS[@]}" "${UP_ARGS[@]}" "${SERVICES[@]}"

APP_URL_VALUE="$(read_setting APP_URL)"
echo "Done. Open ${APP_URL_VALUE:-http://localhost:8080}"
