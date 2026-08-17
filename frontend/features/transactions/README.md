# Transaction screen ownership

The transaction list rendered by the server is the authoritative remote state for this screen.
`TransactionsScreen` keeps only a short-lived optimistic projection in its reducer so edits feel
immediate. A route refresh replaces that projection with the next server result. The screen does
not seed or maintain a parallel React Query cache for transaction rows.

React Query is used only for the independent CSV import-status endpoint. URL state is coordinated
by `use-transaction-query-state`, and presentation components receive state plus intent callbacks.
