# Calling the daemon

There is no REST API to generate code from: the contract is `@agentdeck/protocol`, a zod map of
every command (args → result) and event. All callers are typed from that one map, so a protocol
change breaks every out-of-date caller at compile time.

| Id | Rule | Enforced by |
|---|---|---|
| A1 | The app never opens a socket or calls `fetch` itself. `src/lib/api` is the only daemon and relay client: the encrypted relay connection, the local connection (desktop web) and the relay HTTP API. | `lint:no-restricted-globals` (L9) |
| A2 | `lib/api` exposes `daemonCall<N extends TCommandName>(name, args): Promise<TCommandResult<N>>` and validates every reply with the protocol's result schema. While offline, only `chat.send`, `permission.respond` and `chat.cancel` queue (persisted, same `CmdId`); everything else fails fast. | `tsc`, `test` |
| A3 | Modules wrap commands in hooks in `api/<module>.queries.ts`: `use<Thing>Query` for reads, `use<Verb><Thing>Mutation` for writes. Pages and components use those hooks, never `call` directly. | `lint:no-restricted-imports`, `review` |
| A4 | Commands are retried only with the same `CmdId` (idempotent by protocol); the client generates ids with `newId("cmd")`. | `review` |
| A5 | Daemon events reach the UI through `onDaemonEvent` in `lib/api`. Each module that follows events exposes a `start…Sync()` function that writes them into its query cache or store, and the root page calls them all at startup (routes load lazily, so a listener registered on import could miss events). A connection reports `online` only once it has applied the replay after `sync.hello`. | `review`, `test:e2e` |
| A6 | The daemon's handlers are total: `THandlers` requires a handler for every command, so adding a command without implementing it fails `tsc`. | `tsc` |
| A7 | Protocol changes are additive only (new commands, new optional fields). Removing or renaming needs a protocol version bump. | `review`, `test` (fixtures) |
