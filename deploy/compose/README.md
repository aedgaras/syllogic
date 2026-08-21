# Self-Hosted (Production) Docker Compose

This directory contains the production-grade Docker Compose bundle:

- PostgreSQL 16
- Redis 7
- FastAPI backend + Celery worker/beat
- Next.js app
- Optional Caddy reverse proxy with automatic TLS
- One-shot Drizzle migration job (runs on deploy/boot)

## Quick Start

For a production-mode deployment of the current checkout on your local
machine, the entire first-time setup is one command from the repository root:

```bash
./scripts/prod-up.sh --local
```

This creates `deploy/compose/.env` when needed, fills all required local
settings with generated secrets, builds the production images, and starts the
stack at `http://localhost:8080`. It preserves every existing configured value.
Use `./scripts/prod-up.sh --local --lite` on a resource-constrained machine.

The steps below are for a server or public deployment using prebuilt images.

1. Copy `deploy/compose/.env.example` to `deploy/compose/.env`.
2. Edit `.env` values (at minimum: `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `INTERNAL_AUTH_SECRET`).
   - **CRITICAL**: Set a strong `POSTGRES_PASSWORD` (e.g., `openssl rand -hex 32`).
   - **IMPORTANT**: The `DATABASE_URL` value **must use the same password** you set in `POSTGRES_PASSWORD`. The format is `postgresql://financeuser:YOUR_PASSWORD@postgres:5432/finance_db` where `YOUR_PASSWORD` matches `POSTGRES_PASSWORD`.
   - Generate secrets:
     - `BETTER_AUTH_SECRET`: `openssl rand -hex 32`
     - `INTERNAL_AUTH_SECRET`: `openssl rand -hex 32`
     - `DATA_ENCRYPTION_KEY_CURRENT` (optional, recommended): `openssl rand -base64 32`
   - `APP_URL` defaults to `http://localhost:8080` for LAN/dev mode.
   - `APP_PORT` defaults to `8080`; the app is directly available on that port.
   - For public internet exposure, set `APP_URL`, `CADDY_ADDRESS`, and `ACME_EMAIL`, then start with `--caddy`.
3. Start:

```bash
./scripts/prod-up.sh
```

To include the bundled Caddy reverse proxy:

```bash
./scripts/prod-up.sh --caddy
```

For a Raspberry Pi or a small VPS, use lite mode instead:

```bash
./scripts/prod-up.sh --lite
```

Windows PowerShell/CMD:

```powershell
.\scripts\prod-up.bat -Lite
```

4. Verify all services are running:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml ps
```

All containers should show `Up` status. The `migrate` container will exit after completing database migrations (this is expected).

## Lightweight / Raspberry Pi Mode

Lite mode layers `docker-compose.lite.yml` over the production stack and runs
only PostgreSQL, Redis, migrations, FastAPI, one Celery worker, and Next.js.
The worker embeds Celery Beat, so scheduled jobs continue to work while the
separate Beat process is removed. MCP is not started. Add `--caddy` if the
bundled reverse proxy is wanted.

The override also:

- runs one API worker and one `solo` Celery worker;
- reduces frontend and backend database pools to two connections;
- gives PostgreSQL small-host memory/WAL settings;
- runs Redis without AOF to reduce SD-card writes;
- increases health-check intervals to 30 seconds;
- applies configurable memory limits suitable for a 2 GB ARM64 host.

Use a 64-bit Raspberry Pi OS. Published release images include `linux/arm64`.
Building the images on the Pi is not recommended; pull the prebuilt release
images. Pin `APP_VERSION` to a release containing lite-mode support.

Redis queues are ephemeral in lite mode. If the host restarts with work queued,
retry that import or sync from the UI. Persistent application and PostgreSQL
data are unaffected.

To inspect the effective configuration:

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.lite.yml \
  config
```

## Accessing the Application

Once all containers are running:

- **Web UI**: Open `http://localhost:8080` (or the origin configured with `APP_URL` and `APP_PORT`)
- **Backend API**: Internal at `http://backend:8000`; Caddy proxies its public routes when enabled
- **MCP Server**: Available at `http://localhost:8001` (if enabled)

**First Time Setup**:
1. The app will prompt you to create an account or log in.
2. Follow the authentication flow to set up your profile.
3. Start importing transactions or connecting your accounts.

## Local Build From Current Checkout (Dev/QA)

Use this when you want containers to run your current local code (instead of GHCR prebuilt images):

```bash
./scripts/prod-up.sh --local
```

This is the recommended flow when validating recent code changes.

To build the lite stack from the current checkout, layer the local-build and
lite overrides and name the services explicitly:

```bash
./scripts/prod-up.sh --local --lite
```

## Reusing Existing Dev `.env` Files (Optional)

If you're running this stack from the repo and you already have local dev env files like:

- `backend/.env`
- `frontend/.env.local`

…you can **layer** them into Compose using multiple `--env-file` flags.

Tip: put `deploy/compose/.env` **last** so the Docker-friendly values (like `DATABASE_URL=...@postgres:5432/...`) win over any localhost URLs.

Example (local build):

```bash
docker compose \
  --env-file backend/.env \
  --env-file frontend/.env.local \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.local.yml \
  up -d --build
```

## Notes

- The app publishes `APP_PORT` (8080 by default). Caddy's `HTTP_PORT` and `HTTPS_PORT` are published only when the `caddy` profile is enabled.
- DB migrations run automatically via the `migrate` service. They are idempotent.
- In production-like external DB setups, use `DATABASE_URL` with `?sslmode=require`.
- File uploads and CSV imports are stored in `public/uploads` and persisted via the `uploads_data` Docker volume.
- This bundle defaults to **Postgres 16**. If you have an existing local Docker volume created by **Postgres 15**, you must dump/restore to upgrade (or temporarily set `POSTGRES_IMAGE=postgres:15-alpine` to keep running on 15).
- We set explicit `container_name` values to avoid the `*-1` suffix. This makes container names stable, but it also means you **cannot** scale services with `--scale`, and you shouldn't run multiple Syllogic stacks on the same Docker host without changing names.
- See [`docs/deployment-matrix.md`](../../docs/deployment-matrix.md) for the local and self-hosted environment contract.

## MCP Server (Full Mode)

This bundle includes an **MCP HTTP server** (FastMCP) and starts it by default.
It is intentionally omitted by `prod-up.sh --lite`.

1. Generate an API key in the app UI (Settings -> API Keys).
2. Configure your MCP client to send `Authorization: Bearer pf_...`.
3. Start (or restart) normally:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d
```

MCP port contract:
- Internal container port is fixed at `8001`.
- External host port defaults to `8001` and is bound to `127.0.0.1` only.
- Override external port with `MCP_PORT` (example: `MCP_PORT=9001` maps `9001 -> 8001`).
- Health endpoint is exposed at `http://localhost:${MCP_PORT:-8001}/health`.

Security note: the MCP service is currently best treated as **single-user**. It is bound to loopback by default; set `MCP_BIND_ADDR=0.0.0.0` only if you're deliberately exposing it to a trusted network (LAN/VPN) or fronting it with an auth layer.

## Making GHCR Images Public

For truly one-click installs, the GHCR packages must be public:

- GitHub → org → Packages → select the image → Package settings → **Change visibility** → Public

## Updating

1. Set `APP_VERSION` in `.env` to the new release tag (e.g. `v1.2.3`).
2. Pull + restart:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml pull
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d
```

Do not use `edge` for internet-facing production.

## Encryption Upgrade for Existing Data

If you're upgrading an existing install to the encrypted-field rollout, run from the backend container or backend working directory:

```bash
python postgres_migration/run_encryption_upgrade.py --batch-size 500
```

This command validates encryption keys, runs the backfill, prints coverage counters, and exits non-zero if coverage is incomplete.

Optional:

```bash
# Check coverage without writing changes
python postgres_migration/run_encryption_upgrade.py --batch-size 500 --dry-run

# Clear plaintext columns after your validation window
python postgres_migration/run_encryption_upgrade.py --batch-size 500 --clear-plaintext
```

## One-Command Helpers

From repository root:

- Full Docker local development stack: `./scripts/dev-up.sh --local`
- Local production stack built from this checkout: `./scripts/prod-up.sh --local`
- Full prebuilt self-host stack: `./scripts/prod-up.sh`
- Lightweight ARM64/small-server stack: `./scripts/prod-up.sh --lite`
- Local source-compose smoke validation: `./scripts/local-smoke.sh`
- VPS post-install verification: `deploy/install/post-install-check.sh /opt/syllogic`
- Back up the database + uploads volume: `./scripts/backup.sh`
- Restore from a backup: `./scripts/restore.sh <backup_dir>`

## Backups

```bash
./scripts/backup.sh                        # writes to backups/<UTC timestamp>/
./scripts/backup.sh /path/to/backup/dir     # or an explicit destination
```

Backs up two things, both required to fully recover a deployment:

- **The database** (`db.dump`, `pg_dump -Fc`) -- transactions, accounts, categories, everything in Postgres.
- **The uploads volume** (`uploads.tar.gz`) -- profile photos, merchant logos, people avatars, anything under `LOCAL_STORAGE_PATH`.

It does **not** back up `DATA_ENCRYPTION_KEY_CURRENT` / `DATA_ENCRYPTION_KEY_PREVIOUS`. IBANs, account external IDs, and other encrypted columns in `db.dump` are unreadable without the matching key(s) from the `deploy/compose/.env` the backup was taken from — a backup and a lost key together are as good as no backup. Keep that `.env` (or at minimum its `DATA_ENCRYPTION_KEY_*` values) somewhere durable and separate from the backup files themselves, and note the `DATA_ENCRYPTION_KEY_ID` written into each backup's `manifest.txt` so you know which key a given backup needs.

Automate it with cron, e.g. nightly at 03:00, keeping 14 days:

```cron
0 3 * * * cd /opt/syllogic && ./scripts/backup.sh >> /var/log/syllogic-backup.log 2>&1
```

(Rotation isn't built in -- pair this with your own retention, e.g. `find /opt/syllogic/backups -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} \;`, or point backups at storage that already expires old objects.)

### Restore drill

Practice this before you need it for real -- ideally on a disposable stack, not production.

```bash
./scripts/restore.sh backups/20260101T030000Z
```

This stops `app`/`backend`/`worker`/`beat`/`mcp` (leaves `postgres`/`redis` up), `pg_restore --clean`s the database, and untars `uploads.tar.gz` over the uploads volume, wiping whatever was there first. It's destructive and asks for confirmation (type the database name) unless run with `--yes`. It does not restart the stack — after it finishes, verify `DATA_ENCRYPTION_KEY_CURRENT`/`PREVIOUS` in `deploy/compose/.env` match the backup's `manifest.txt`, then run `./scripts/prod-up.sh`.

To actually rehearse a restore without touching a real deployment, point both scripts at an isolated Compose project and env file:

```bash
COMPOSE_PROJECT_NAME=syllogic-restore-drill ENV_FILE=/path/to/scratch.env ./scripts/backup.sh /tmp/drill
# ...mutate/seed the scratch stack...
COMPOSE_PROJECT_NAME=syllogic-restore-drill ENV_FILE=/path/to/scratch.env ./scripts/restore.sh /tmp/drill --yes
```
