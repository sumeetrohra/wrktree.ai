# Structure and import boundaries

Every file lives in exactly one layer. A layer may import only from the layers listed for it.
Boundaries are checked by per-layer `no-restricted-imports` patterns (`lint:no-restricted-imports`)
and a structure test that fails on any file outside a known layer (`test:structure`). Relative
imports may go up at most one level; anything further uses the `#src/` alias (Node packages) or `@/` (the app).

## The idea in one paragraph

**Modules** own one capability each and never know about one another. **Pages** (in the app) and
**handlers** (in the daemon) are the only places that combine modules; they decide what data a
screen or command needs and wire modules together. **Infra** / **lib** wrap the outside world
(databases, sockets, processes, SDKs). **Shared** holds pure, dependency-free building blocks.
When a module needs something another module provides, it declares a *port* (an `I…` interface)
in its own `.types.ts`, and the composition layer passes in an implementation.

## Workspace

```
packages/protocol/   zod schemas for every frame, command, event and model. Depends on nothing internal.
packages/shared/     ids, time, json parsing, result, logger interface. Depends on nothing internal.
packages/crypto/     identity keys, pairing transcript, handshake, sealed frames. Depends only on shared.
apps/daemon/         the daemon (Node)
apps/relay/          the relay: Cloudflare Worker + Durable Objects, and a Node self-host build
apps/cli/            the `agentdeck` CLI (Node)
apps/mobile/         the app (Expo: iOS, Android, web)
tools/fake-agent/    scripted ACP agent for tests
tools/lint-fixtures/ deliberately broken files proving each lint rule fires
e2e/                 end-to-end suite and video recorder
```

Packages are imported by package name (`@agentdeck/protocol`), never by relative path into
another package (S1, `lint:no-restricted-imports`).

## Daemon (`apps/daemon/src`)

```
main.ts                         entry: starts the daemon, nothing else
app/
  create-daemon.ts              composition root: builds infra, modules, wires ports, registers handlers
  handlers/<group>.handlers.ts  one file per command group (repo, profile, worktree, chat, fs, diff, blob, sync)
modules/<name>/
  index.ts                      the module's public API; the only file others may import
  <name>.service.ts             the module's main class
  <name>.types.ts               its types and the ports (I… interfaces) it needs from elsewhere
  <name>.schema.ts              its zod schemas (optional)
  <name>.constants.ts / <name>.utils.ts / internal files (optional)
  *.test.ts                     co-located tests
infra/<adapter>/                db, bus, transport, process, acp, search, log
shared/                         constants, errors, pure utils used only inside the daemon
```

| Layer | May import |
|---|---|
| `main` | `app` |
| `app` (incl. `handlers`) | `modules/*/index.ts`, `infra`, `shared`, packages |
| `modules/<x>` | its own files, `infra`, `shared`, packages — **never another module** |
| `infra` | `infra` (same adapter), `shared`, packages |
| `shared` | `shared`, packages |

## CLI (`apps/cli/src`)

```
main.ts                     entry: parses argv and dispatches to a command
commands/<name>.command.ts  one file per top-level command ("routes")
lib/daemon-client/          the only code that opens a socket to the daemon
shared/output/              terminal formatting and printing
```

`main → commands → lib, shared`; `lib → shared`; `shared → shared`.

## Relay (`apps/relay/src`)

```
main.worker.ts, main.node.ts  entries for the two hosts
app/create-relay.ts           the Hono API (same on both hosts)
app/routes/*.routes.ts        one file per route group ("handlers")
app/node-host.ts              self-host composition (one SQLite file per account hub)
app/worker-host.ts            Worker composition (Directory and Hub Durable Objects)
modules/directory/            accounts, devices, magic-link codes, pairing offers
modules/hub/                  one account's mailbox: routing, buffer, acks, wake pushes
infra/{sql,node,worker,jwt,mail,oauth,push,log}  one wrapper per library or runtime
shared/                       ports (`ISql`, `IHubSockets`, `IPushSender`), constants, env schema
```

Same rules as the daemon. Modules depend only on ports in `shared/`, so the same directory and hub
code runs on Durable Object SQLite and on better-sqlite3.

## App (`apps/mobile/src`)

```
app/                        Expo Router route files ONLY. Each is one line: export a page as default.
pages/<page>/               <page>-page.tsx + index.ts. Decides data and layout; composes modules.
modules/<module>/
  components/  hooks/  stores/  api/  schemas/  types/  utils/  constants/
  index.ts                  public API
lib/api/                    the typed daemon client, query keys, event → cache bridge
providers/                  QueryProvider, ThemeProvider, I18nProvider: composition only
shared/
  components/ui/            React Native Reusables (generated; not edited, not linted)
  components/  hooks/  stores/  utils/  types/  constants/  i18n/
```

| Layer | May import |
|---|---|
| `app` (routes) | `pages` |
| `pages` | `modules/*/index.ts`, `shared`, `lib`, `providers` |
| `modules/<x>` | its own files, `shared`, `lib` — **never another module, never a page** |
| `lib` | `shared`, packages |
| `providers` | `lib`, `shared` |
| `shared` | `shared` |

## Rules

| Id | Rule | Enforced by |
|---|---|---|
| S1 | No relative import into another workspace package; use its package name. | `lint:no-restricted-imports` |
| S2 | Relative imports go up at most one level (`../x`, never `../../x`). | `lint:no-restricted-imports` |
| S3 | A module is imported only through its `index.ts`. | `lint:no-restricted-imports` |
| S4 | Modules never import other modules; pages/handlers compose them. | `lint:no-restricted-imports` |
| S5 | Every file belongs to a known layer; stray folders fail lint. | `test:structure` |
| S6 | Route files (`app/`) contain no logic: a default export of a page. | `lint:no-restricted-imports`, `review` |
| S7 | Tests sit next to the code they test. | `review` |
| S8 | One responsibility per module. When a module needs another's data, add a port to its `.types.ts`. | `review` |
