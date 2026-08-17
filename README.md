<div align="center">
  <h1>Syllogic</h1>
  <p>A home-server-focused personal finance app.</p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="deploy/compose/README.md">Deployment guide</a> ·
    <a href="CONTRIBUTING.md">Contributing</a> ·
    <a href="ROADMAP.md">Roadmap</a>
  </p>
</div>

Syllogic is an open-source personal finance dashboard for people who want to
keep their financial data on infrastructure they control. It tracks balances,
transactions, spending, recurring charges, investments, and cash-flow trends.
It also supports CSV imports, bank integrations, optional AI categorization,
and an MCP server for compatible clients.

> [!IMPORTANT]
> This repository is an independent fork of
> [`syllogic-ai/syllogic`](https://github.com/syllogic-ai/syllogic). It is not
> the upstream project. This fork focuses on private Docker Compose deployments,
> including resource-constrained VPS and ARM64 home servers.

## Highlights

- Self-hosted Next.js and FastAPI application
- PostgreSQL-backed accounts, transactions, categories, and investments
- CSV import/export and optional bank synchronization
- Recurring-payment and subscription detection
- Optional OpenAI-powered transaction categorization
- Optional OIDC single sign-on configured by an administrator
- Full and lightweight Docker Compose stacks
- MCP access for trusted local or VPN-connected clients

## Quick start

### Requirements

- Git
- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose version`)

### 1. Clone and configure

```bash
git clone https://github.com/aedgaras/syllogic.git
cd syllogic
cp deploy/compose/.env.example deploy/compose/.env
```

Edit `deploy/compose/.env` and replace at least these values:

- `POSTGRES_PASSWORD`
- `BETTER_AUTH_SECRET`
- `INTERNAL_AUTH_SECRET`
- `DATA_ENCRYPTION_KEY_CURRENT` (strongly recommended)

Generate independent secrets with:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Keep the password embedded in `DATABASE_URL` identical to
`POSTGRES_PASSWORD`.

For LAN-only HTTP, use:

```dotenv
APP_URL=http://localhost:8080
CADDY_ADDRESS=:80
```

For an internet-facing deployment, use your real HTTPS origin and configure
`ACME_EMAIL`:

```dotenv
APP_URL=https://finance.example.com
CADDY_ADDRESS=finance.example.com
ACME_EMAIL=admin@example.com
```

### 2. Start the stack

Build the current checkout and start it:

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.local.yml \
  up -d --build
```

Or use the production helper to run the prebuilt images configured by the
Compose bundle:

```bash
./scripts/prod-up.sh
```

Windows users can run:

```powershell
.\scripts\prod-up.bat
```

### 3. Verify and sign in

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  ps
```

Open the configured `APP_URL`. The one-shot `migrate` service should exit with
code 0; the other services should be running or healthy. The first registered
user becomes the administrator.

See [`deploy/compose/README.md`](deploy/compose/README.md) for TLS, updates,
backups, MCP configuration, and troubleshooting.

## Lightweight mode

Lite mode is intended for Raspberry Pi and roughly 2 GB-class hosts. It reduces
database pools and memory limits, combines the Celery worker and scheduler, and
omits the MCP service.

```bash
./scripts/prod-up.sh --lite
```

When building the current checkout locally:

```bash
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.local.yml \
  -f deploy/compose/docker-compose.lite.yml \
  up -d --build postgres redis uploads-init migrate backend worker app caddy
```

Lite mode disables Redis persistence. Interrupted imports or syncs may need to
be retried, but PostgreSQL data and uploaded files remain persistent.

## Configuration

| Variable | Purpose | Required |
|---|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password | Yes |
| `DATABASE_URL` | Shared PostgreSQL connection URL | Yes |
| `BETTER_AUTH_SECRET` | Session signing secret | Yes |
| `INTERNAL_AUTH_SECRET` | Frontend-to-backend authentication | Yes |
| `DATA_ENCRYPTION_KEY_CURRENT` | Encrypts stored credentials and sensitive fields | Recommended |
| `OPENAI_API_KEY` | Enables AI categorization | No |
| `LOGO_DEV_API_KEY` | Enables merchant logo lookup | No |

The complete variable reference is in
[`deploy/compose/.env.example`](deploy/compose/.env.example).

### OIDC single sign-on

Administrators can configure one OpenID Connect provider from **Settings →
Authentication**. Before enabling it:

1. Set `APP_URL` to the exact public HTTPS origin.
2. Set and back up `DATA_ENCRYPTION_KEY_CURRENT`.
3. Register this callback with the provider:
   `https://finance.example.com/api/auth/oauth2/callback/oidc`.
4. Request the `openid`, `profile`, and `email` scopes.
5. Test sign-in in a private browser window while keeping the local admin
   session open.

Email/password authentication remains available. Losing or changing the data
encryption key makes stored provider credentials unreadable.

## Architecture

| Path | Purpose |
|---|---|
| `frontend/` | Next.js UI, authentication, server actions, Drizzle schema, and migrations |
| `backend/` | FastAPI endpoints, integrations, Celery jobs, and SQLAlchemy models |
| `deploy/compose/` | Full, local-build, and lightweight Compose definitions |
| `scripts/` | Development, production, smoke-test, and validation helpers |

The frontend and backend share PostgreSQL. The frontend handles interactive
application workflows; the backend performs enrichment, synchronization,
reporting, and background jobs. Redis provides task queues and caching.

## Development

Start the full development stack with source mounts and hot reload:

```bash
./scripts/dev-up.sh
```

On Windows:

```powershell
.\scripts\dev-up.bat
```

Then open `http://localhost:3000`.

Useful commands:

```bash
docker compose ps
docker compose logs -f frontend backend
docker compose down
```

Run the deployment contract check after changing deployment files:

```bash
./scripts/verify-deploy-contract.sh
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for host-run setup, tests, and code
style.

## License

Licensed under the [GNU Affero General Public License v3.0](LICENSE).
