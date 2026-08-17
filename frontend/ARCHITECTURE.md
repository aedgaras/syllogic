# Frontend Architecture

The frontend is migrating incrementally toward feature-first boundaries. Existing code may temporarily appear in legacy locations, but new and migrated code follows this dependency direction:

```text
app route
  -> feature orchestration
      -> feature hooks/client adapters
      -> feature presentation components
      -> server entry points
          -> application use cases
              -> domain and external-service ports
          -> server adapters
```

`shared/` and `components/ui/` never import a feature. Domain code never imports React, Next.js, Drizzle, browser APIs, or server actions. Cross-feature dependencies use the other feature's `public.ts` or `server.ts` entry point.

## Responsibilities

- **Orchestration** owns workflows, remote-state coordination, navigation, invalidation, optimistic updates, and user-feedback policy. Routes should compose orchestration and establish route-level boundaries, not implement feature behavior.
- **Hooks** adapt React lifecycle or browser behavior such as URL state, SSE, media queries, and storage. Non-trivial parsing, calculations, and state transitions belong in pure modules.
- **Presentation** renders typed view models and emits user intent through callbacks. It does not import navigation, toast, query clients, database types, server actions, or repositories.

The complete migration sequence and design rationale live in [ARCHITECTURE_REFACTORING_PLAN.md](./ARCHITECTURE_REFACTORING_PLAN.md).

## Enforcement

`pnpm lint` reports architecture boundary violations as errors. `pnpm lint:boundaries` verifies the same dependency rules, including fixture coverage, against a zero-violation baseline.

## Reference feature

`features/accounts` is the smallest complete reference slice:

1. `domain/contracts.ts` defines serializable, persistence-independent contracts.
2. `application/recalculate-account.ts` coordinates a business use case through narrow ports.
3. `server/accounts.repository.ts` and `server/timeseries.gateway.ts` implement database and backend seams.
4. `server.ts` is the server-only public entry point; `public.ts` exposes safe contracts and orchestration.
5. `client/actions.ts` adapts mutations for client controllers.
6. `orchestration/account-detail.tsx` owns screen coordination while existing views receive data and callbacks.

When adding a feature, start with only the folders its responsibilities require. Keep feature-specific helpers in the feature; promote a module to `shared/` only after unrelated features use the same contract or browser adapter.
