# Calling the daemon

There is no REST API to generate code from: the contract is `@agentdeck/protocol`, a zod map of
every command (args → result) and event. All callers are typed from that one map, so a protocol
change breaks every out-of-date caller at compile time.

| Id | Rule | Enforced by |
|---|---|---|
| A1 | The app never opens a socket or calls `fetch` itself. `src/lib/api` is the only daemon client. | `lint:no-restricted-globals` (L9) |
| A2 | `lib/api` exposes `call<N extends TCommandName>(name, args): Promise<TCommandResult<N>>` and validates every reply with the protocol's result schema. | `tsc`, `test` |
| A3 | Modules wrap commands in hooks in `api/<module>.queries.ts`: `use<Thing>Query` for reads, `use<Verb><Thing>Mutation` for writes. Pages and components use those hooks, never `call` directly. | `lint:no-restricted-imports`, `review` |
| A4 | Commands are retried only with the same `CmdId` (idempotent by protocol); the client generates ids with `newId("cmd")`. | `review` |
| A5 | Daemon events reach the UI through the event bridge in `lib/api`, which invalidates the matching query keys (and feeds the chat store, D8). | `review` |
| A6 | The daemon's handlers are total: `THandlers` requires a handler for every command, so adding a command without implementing it fails `tsc`. | `tsc` |
| A7 | Protocol changes are additive only (new commands, new optional fields). Removing or renaming needs a protocol version bump. | `review`, `test` (fixtures) |
