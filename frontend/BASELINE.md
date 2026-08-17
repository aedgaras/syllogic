# Frontend Refactoring Baseline

Recorded on 2026-08-17 from the repository root's `frontend/` directory before Phase 0 behavior changes.

| Check                    | Result              | Notes                                                                                                                                      |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`              | pass                | 0 errors, 88 existing warnings                                                                                                             |
| `pnpm exec tsc --noEmit` | environment blocked | Concurrent pnpm version switching could not verify the registry signature; direct local `./node_modules/.bin/tsc --noEmit` passed          |
| `pnpm exec vitest run`   | environment blocked | Same pnpm registry-signature issue; direct local Vitest ran 27 files / 165 tests: 151 passed and 14 existing failures                      |
| mobile smoke test        | not run             | Authenticated test credentials were not available; `playwright test --list` discovered 40 tests across four viewports                      |
| `pnpm build`             | environment blocked | Direct local Next build reached compilation, then failed because sandboxed network access could not fetch JetBrains Mono from Google Fonts |

The 14 existing test failures comprise six `AccountPicker` tests and six `HoldingsTableHF` tests that render React Query consumers without a `QueryClientProvider`, plus two `render-report` subprocess tests that exit with status 1. These are baseline debt, not Phase 0 regressions.

Use the package scripts for subsequent checks:

```sh
pnpm lint
pnpm lint:boundaries
pnpm typecheck
pnpm test
pnpm test:smoke:mobile
pnpm build
```
