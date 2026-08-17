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

`pnpm lint` reports all boundary violations as warnings while legacy code is migrated. `pnpm lint:boundaries` compares current findings with `architecture-boundaries-baseline.json` and fails on any new violation. The baseline must only shrink; do not add new entries to make CI pass.

