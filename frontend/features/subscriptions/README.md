# Subscriptions feature

## Dependency boundary

- `domain/` owns canonical DTOs, amount/frequency rules, matching, and the list reducer.
- `client/` is the only client-side adapter allowed to reference legacy server actions.
- `hooks/` owns mutation feedback and screen/detail workflow state.
- `server.ts` is the server-only route facade while the legacy action implementation is split incrementally.
- Transaction UI imports `client/transaction-linking.ts`; it passes transaction IDs obtained from `features/transactions/public.ts` and does not import subscription server implementation files.

## Cache ownership

The subscription list reducer is the sole owner of list rows for a mounted screen. Mutations are pessimistic: the reducer changes only after a successful server response. Toggle, delete, and suggestion dismissal do not call `router.refresh()`. Form completion may refresh server-rendered KPI data, while the returned subscription DTO is applied directly to the list reducer.
