#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="local"

generate_encryption_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  # /dev/urandom and od are available on the Linux and macOS hosts supported
  # by this script. Keep this fallback so OpenSSL is not an extra prerequisite.
  od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]'
}

ensure_local_encryption_key() {
  local env_file="$1"
  local current_key=""

  if [ -f "$env_file" ]; then
    current_key="$(sed -n 's/^[[:space:]]*DATA_ENCRYPTION_KEY_CURRENT[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -n 1 | tr -d '\r')"
  else
    mkdir -p "$(dirname "$env_file")"
    : > "$env_file"
  fi

  if [ -n "$current_key" ]; then
    return
  fi

  local generated_key
  local temp_file
  generated_key="$(generate_encryption_key)"
  temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"

  awk -v key="$generated_key" '
    BEGIN { written = 0 }
    /^[[:space:]]*DATA_ENCRYPTION_KEY_CURRENT[[:space:]]*=/ {
      if (!written) {
        print "DATA_ENCRYPTION_KEY_CURRENT=" key
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) print "DATA_ENCRYPTION_KEY_CURRENT=" key
    }
  ' "$env_file" > "$temp_file"
  mv "$temp_file" "$env_file"
  chmod 600 "$env_file" 2>/dev/null || true

  echo "Generated the local data-encryption key in deploy/compose/.env."
}

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
ensure_local_encryption_key "$ENV_COMPOSE_FILE"

compose_args=(--env-file "$ENV_COMPOSE_FILE")

echo "Starting local development stack..."
docker compose "${compose_args[@]}" -f "$ROOT_DIR/docker-compose.yml" up -d --build

echo ""
echo "Done."
echo ""
echo "Open http://localhost:3000"
echo "Backend API: http://localhost:8000"
echo "Add your OpenAI API key in Settings > Preferences when you need AI categorization."
echo ""
echo "Logs: docker compose -f docker-compose.yml logs -f frontend backend"
