# Contributing to Syllogic

Thanks for your interest in contributing. This guide covers how to set up a development environment and submit changes.

## Prerequisites

- Git
- Docker Desktop or Docker Engine
- Docker Compose v2 (`docker compose version`)
- At least 4 GB available Docker memory
- Internet access on first run, so Docker can pull images and install container dependencies

Node.js, pnpm, and Python 3.11+ are optional for the default workflow. You only need them when running frontend or backend services directly on your host.

## Development Setup

### One-Command Docker Setup

The quickest way to get a development environment running:

```bash
# Linux/macOS
./scripts/dev-up.sh

# Windows
.\scripts\dev-up.bat
```

This starts the full local stack in Docker:

- PostgreSQL at `localhost:5433`
- Redis at `localhost:6379`
- FastAPI backend at `http://localhost:8000`
- Next.js dev server at `http://localhost:3000`
- Celery worker and beat
- A one-shot database migration job

Source files are mounted into the containers, so frontend and backend edits are picked up without rebuilding in normal development.

Useful commands:

```bash
docker compose ps
docker compose logs -f frontend backend
docker compose down
```

On first run, `dev-up` creates `deploy/compose/.env` when needed and generates the persistent data-encryption key required to store app settings securely. Existing values are preserved. Add your own OpenAI API key under **Settings > Preferences** when you want to exercise AI categorization; the startup script intentionally does not collect it. Other optional local secrets and integration keys can go in the same env file. The Docker dev stack has local defaults for required auth secrets, database URLs, and Redis URLs.

### Host-Run Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: set INTERNAL_AUTH_SECRET
```

Start the API server:

```bash
uvicorn app.main:app --reload
```

Start background workers (separate terminals):

```bash
celery -A celery_app worker --loglevel=info
celery -A celery_app beat --loglevel=info
```

### Host-Run Frontend

```bash
cd frontend
pnpm install
cp .env.example .env.local
# Edit .env.local: set BETTER_AUTH_SECRET and the same INTERNAL_AUTH_SECRET
pnpm dev
```

App available at http://localhost:3000.

### Production Compose QA

Use this when you need to test the production Compose bundle with images built from your local checkout. For normal source development, use `./scripts/dev-up.sh` instead.

```bash
cp deploy/compose/.env.example deploy/compose/.env
# Edit deploy/compose/.env
docker compose \
  --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.local.yml \
  up -d --build
```

## Database Management

```bash
cd frontend
pnpm db:push       # Push schema changes to database
pnpm db:generate   # Generate migration files
pnpm db:studio     # Open Drizzle Studio (database GUI)
```

Schema changes must be made in Drizzle first (source of truth), then mirrored to SQLAlchemy models in the backend.

## Code Style

### Frontend

- TypeScript strict mode
- Server Actions for all data mutations
- shadcn/ui components before building custom UI
- Follow the existing folder structure and naming conventions

### Backend

- PEP 8 style guide
- Type hints where practical

## Submitting Changes

1. Fork the repository and create a feature branch
2. Make your changes following the style guidelines above
3. Test your changes thoroughly
4. Update documentation if you're changing functionality
5. Submit a pull request with a clear description of changes

## Reporting Issues

Use GitHub Issues to report bugs or request features. Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment details (OS, browser, etc.)
