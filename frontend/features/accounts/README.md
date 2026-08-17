# Accounts feature

`public.ts` exposes serializable account contracts and the account-detail orchestrator. Server-rendered routes use `server.ts`; client controllers use `client/actions.ts`.

The account-detail route owns remote data on the server. Its client orchestrator keeps only short-lived optimistic transaction updates and replaces them when refreshed server props arrive. Balance calculations live in `domain/`, recalculation workflows in `application/`, database access in `server/accounts.repository.ts`, and backend calls in `server/timeseries.gateway.ts`.

