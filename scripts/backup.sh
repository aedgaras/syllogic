#!/usr/bin/env bash
# Backs up the Postgres database and the uploads volume for a Compose
# deployment. Does NOT back up DATA_ENCRYPTION_KEY_CURRENT/PREVIOUS -- those
# live in deploy/compose/.env and must be preserved separately (a backup of
# encrypted data is unreadable without them; see restore.sh and
# deploy/compose/README.md).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/compose/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/compose/docker-compose.yml}"
OUT_DIR="${1:-$ROOT_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)}"

usage() {
  cat <<'EOF'
Usage: backup.sh [output_dir]

Dumps the Postgres database (pg_dump custom format) and archives the
uploads volume into output_dir (default: backups/<UTC timestamp>/).

Env:
  ENV_FILE  Path to the Compose .env file (default: deploy/compose/.env)
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Set ENV_FILE or run this against a deployment that has one." >&2
  exit 1
fi

read_setting() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

POSTGRES_USER_VALUE="$(read_setting POSTGRES_USER)"
POSTGRES_DB_VALUE="$(read_setting POSTGRES_DB)"
LOCAL_STORAGE_PATH_VALUE="$(read_setting LOCAL_STORAGE_PATH)"
LOCAL_STORAGE_PATH_VALUE="${LOCAL_STORAGE_PATH_VALUE:-/data/uploads}"

if [ -z "$POSTGRES_USER_VALUE" ] || [ -z "$POSTGRES_DB_VALUE" ]; then
  echo "POSTGRES_USER / POSTGRES_DB not set in $ENV_FILE." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

if ! compose ps postgres --status running --format '{{.Name}}' 2>/dev/null | grep -q .; then
  echo "The postgres service isn't running. Start the stack first (./scripts/prod-up.sh)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Dumping Postgres ($POSTGRES_DB_VALUE) ..."
compose exec -T postgres pg_dump -U "$POSTGRES_USER_VALUE" -Fc "$POSTGRES_DB_VALUE" > "$OUT_DIR/db.dump"

if compose ps app --status running --format '{{.Name}}' 2>/dev/null | grep -q .; then
  echo "Archiving uploads volume ($LOCAL_STORAGE_PATH_VALUE) ..."
  compose exec -T app tar czf - -C "$LOCAL_STORAGE_PATH_VALUE" . > "$OUT_DIR/uploads.tar.gz"
else
  echo "WARNING: the app service isn't running -- skipping the uploads volume archive." >&2
fi

DATA_ENCRYPTION_KEY_ID_VALUE="$(read_setting DATA_ENCRYPTION_KEY_ID)"
cat > "$OUT_DIR/manifest.txt" <<EOF
Backup created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Postgres database: $POSTGRES_DB_VALUE
Uploads volume path: $LOCAL_STORAGE_PATH_VALUE
DATA_ENCRYPTION_KEY_ID at backup time: ${DATA_ENCRYPTION_KEY_ID_VALUE:-k1}

This backup does NOT include DATA_ENCRYPTION_KEY_CURRENT or
DATA_ENCRYPTION_KEY_PREVIOUS. IBANs, account external IDs, and other
encrypted columns in db.dump are unreadable without the matching key(s)
from the deploy/compose/.env this backup was taken from. Store that .env
(or at minimum its DATA_ENCRYPTION_KEY_* values) somewhere durable and
separate from this backup -- losing both together means losing the data
even though the backup file itself is intact.
EOF

echo "Done: $OUT_DIR"
cat "$OUT_DIR/manifest.txt"
