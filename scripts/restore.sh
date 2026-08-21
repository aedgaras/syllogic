#!/usr/bin/env bash
# Restores a backup made by backup.sh: replaces the live Postgres database
# and the uploads volume. Destructive -- requires confirmation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/compose/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/compose/docker-compose.yml}"

usage() {
  cat <<'EOF'
Usage: restore.sh <backup_dir> [--yes]

Restores db.dump (pg_restore --clean) and uploads.tar.gz (if present) from
a directory created by backup.sh, replacing the live database and uploads
volume. Stops the app/backend/worker/beat/mcp services first; leaves
postgres and redis running. Does not restart the stack afterward -- run
./scripts/prod-up.sh once you've verified the restore.

--yes  Skip the confirmation prompt (for scripted/CI use).

IMPORTANT: db.dump only decrypts correctly if the current
deploy/compose/.env has the same DATA_ENCRYPTION_KEY_CURRENT (and, if the
backup predates a key rotation, DATA_ENCRYPTION_KEY_PREVIOUS) as when the
backup was taken -- check manifest.txt in the backup directory.
EOF
}

BACKUP_DIR="${1:-}"
ASSUME_YES="false"
for arg in "${@:2}"; do
  case "$arg" in
    --yes) ASSUME_YES="true" ;;
  esac
done

if [ -z "$BACKUP_DIR" ] || [ "$BACKUP_DIR" = "-h" ] || [ "$BACKUP_DIR" = "--help" ]; then
  usage
  exit 0
fi
if [ ! -d "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/db.dump" ]; then
  echo "No db.dump found in $BACKUP_DIR (expected a directory created by backup.sh)." >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Set ENV_FILE or run this against a deployment that has one." >&2
  exit 1
fi

if [ -f "$BACKUP_DIR/manifest.txt" ]; then
  echo "--- $BACKUP_DIR/manifest.txt ---"
  cat "$BACKUP_DIR/manifest.txt"
  echo "---"
fi

if [ "$ASSUME_YES" != "true" ]; then
  echo "This REPLACES the live database$( [ -f "$BACKUP_DIR/uploads.tar.gz" ] && echo " and uploads volume" ). This cannot be undone."
  read -r -p "Type the database name to confirm: " confirm_name
fi

read_setting() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

POSTGRES_USER_VALUE="$(read_setting POSTGRES_USER)"
POSTGRES_DB_VALUE="$(read_setting POSTGRES_DB)"
LOCAL_STORAGE_PATH_VALUE="$(read_setting LOCAL_STORAGE_PATH)"
LOCAL_STORAGE_PATH_VALUE="${LOCAL_STORAGE_PATH_VALUE:-/data/uploads}"

if [ "$ASSUME_YES" != "true" ] && [ "${confirm_name:-}" != "$POSTGRES_DB_VALUE" ]; then
  echo "Name didn't match ($POSTGRES_DB_VALUE). Aborting." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Stopping app-tier services (postgres/redis stay up) ..."
compose stop app backend worker beat mcp 2>/dev/null || true

echo "Restoring Postgres ($POSTGRES_DB_VALUE) ..."
compose exec -T postgres pg_restore -U "$POSTGRES_USER_VALUE" -d "$POSTGRES_DB_VALUE" \
  --clean --if-exists --no-owner < "$BACKUP_DIR/db.dump"

if [ -f "$BACKUP_DIR/uploads.tar.gz" ]; then
  echo "Restoring uploads volume ($LOCAL_STORAGE_PATH_VALUE) ..."
  compose run --rm --no-deps -T app sh -c \
    "find '$LOCAL_STORAGE_PATH_VALUE' -mindepth 1 -delete && tar xzf - -C '$LOCAL_STORAGE_PATH_VALUE'" \
    < "$BACKUP_DIR/uploads.tar.gz"
else
  echo "No uploads.tar.gz in $BACKUP_DIR -- leaving the uploads volume untouched."
fi

echo "Restore complete. Verify DATA_ENCRYPTION_KEY_CURRENT/PREVIOUS in $ENV_FILE match the backup (see manifest.txt), then run ./scripts/prod-up.sh."
