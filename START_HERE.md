# Start Here

Syllogic is a self-hosted personal finance dashboard with optional AI categorization, recurring spend tracking, and CSV import/export.

## What it is

Syllogic gives self-hosters a finance app they can actually run themselves:

- balances, spending trends, and cash-flow views
- recurring subscription tracking
- CSV import/export workflows
- optional OpenAI-powered categorization
- Docker Compose deployment for local servers, VPS hosts, and ARM64 devices

## Who it is for

- Self-hosters who want a real app instead of a spreadsheet stack
- Privacy-focused users who do not want transaction history locked into a hosted product
- Homelab and VPS users who want a polished deployment path without giving up control

## Get started

### Self-host with Docker

```bash
git clone https://github.com/aedgaras/syllogic.git
cd syllogic
cp deploy/compose/.env.example deploy/compose/.env
# Edit deploy/compose/.env, then:
./scripts/prod-up.sh
```

For the manual setup, use [README.md](README.md#quick-start).

## Next links

- [README](README.md)
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Report an issue](https://github.com/aedgaras/syllogic/issues/new/choose)
