# syntax=docker/dockerfile:1.7

##
# Backend (FastAPI + Celery) production image.
# - Multi-stage build (keep build deps out of runtime)
# - Non-root runtime user
##

FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Build deps (kept only in builder stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
  && rm -rf /var/lib/apt/lists/*

# Create venv so we can copy it into the runtime image
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt


##
# Compile the React Email report renderer into one self-contained script so
# every backend container does not carry the frontend dependency tree.
# - This backend Dockerfile's primary build context stays `./backend`.
#   frontend/ is supplied as a separate
#   *named* BuildKit context called "frontend" -- see the `additional_contexts`
#   entries in docker-compose.yml / deploy/compose/docker-compose.local.yml
#   and the `build-contexts` input in .github/workflows/docker-build.yml.
#   Any build invocation that does NOT pass that named context (e.g. a bare
#   `docker build ./backend`) will fail this stage.
##
FROM node:20-bookworm-slim AS report-builder

WORKDIR /frontend

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY --from=frontend package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=frontend xlsx-0.20.3.tgz ./xlsx-0.20.3.tgz

RUN pnpm install --frozen-lockfile

COPY --from=frontend emails ./emails
COPY --from=frontend i18n ./i18n
COPY --from=frontend messages ./messages
COPY --from=frontend tsconfig.json ./tsconfig.json

RUN ESBUILD_BIN="$(find node_modules/.pnpm -path '*/node_modules/esbuild/bin/esbuild' -type f -print -quit)" \
  && test -n "$ESBUILD_BIN" \
  && node "$ESBUILD_BIN" emails/render-report.ts \
    --bundle \
    --platform=node \
    --format=cjs \
    --jsx=automatic \
    --tsconfig=tsconfig.json \
    --outfile=/render-report.cjs


FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PATH="/opt/venv/bin:$PATH"
ENV PROCESS_TYPE=api
# Location of the bundled report renderer.
ENV FRONTEND_EMAILS_DIR=/frontend/emails

# Runtime deps: libpq for Postgres connectivity and Node.js for the bundled
# report renderer. npm is not required.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    nodejs \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY . .

# Self-contained report renderer compiled in the report-builder stage.
COPY --from=report-builder /render-report.cjs /frontend/emails/render-report.cjs

# Non-root user for production hardening
RUN useradd --create-home --uid 10001 app \
  && chown -R app:app /app /frontend
USER app

EXPOSE 8000

# Use PROCESS_TYPE to run API, MCP, Celery worker, or Celery beat from the same image.
CMD ["sh", "-c", "if [ \"$PROCESS_TYPE\" = \"worker\" ]; then exec celery -A celery_app worker --loglevel=info --concurrency=${CELERY_CONCURRENCY:-4} --pool=${CELERY_POOL:-prefork}; elif [ \"$PROCESS_TYPE\" = \"beat\" ]; then exec celery -A celery_app beat --loglevel=info; elif [ \"$PROCESS_TYPE\" = \"mcp\" ]; then exec uvicorn mcp_server:app --host 0.0.0.0 --port ${PORT:-8001}; else exec gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --timeout 120; fi"]
