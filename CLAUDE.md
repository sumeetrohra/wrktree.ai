# Agentdeck — guide for coding agents

Agentdeck lets you drive coding agents (Claude Code, Codex, Gemini) running on your computers from
your phone or browser. You sign in (Firebase Auth); each computer joins the account once with
`agentdeck login`, and the account's device list on the relay is the trust root (docs/phase-2.md, 2c). Read [`docs/tech-spec.md`](docs/tech-spec.md) for the design and
[`docs/phase-1.md`](docs/phase-1.md) for what exists.

## Before you change anything

The rules in [`docs/rules/`](docs/rules/README.md) are mandatory; most are enforced by lint and
the type checker. The ones that most often matter:

- **Layers.** Modules never import other modules. Pages (app) and handlers (daemon) compose them.
  A module that needs something declares a port (`I…` interface) in its `.types.ts`.
- **Library wrappers.** `better-sqlite3`, the ACP SDK, `ws`, `child_process`, ripgrep, pino, the
  `@noble` crypto libraries, Hono, `jose`, dayjs, Sentry and the app's `fetch`/`WebSocket` are each
  imported only in their wrapper (docs/rules/library-calls.md).
- **Types.** No `any`, no `!`, no `as` (except `as const`). Parse untrusted data with zod.
  Types are `TFoo`, interfaces `IFoo`, schemas `fooSchema`.
- **Files.** kebab-case, with a purpose suffix (`.service.ts`, `.types.ts`, `.schema.ts`,
  `.handlers.ts`, `.store.ts`, `.queries.ts`, `.test.ts`).
- **React.** No `useEffect`, no Context, no `useMemo`/`useCallback`/`memo`. Server state in React
  Query, client state in Zustand, UI from React Native Reusables, strings through i18n.
- **Hosts.** Every daemon call in the app names its host: `daemonCall(hostId, …)`, and
  `onDaemonEvent((hostId, e) => …)`. Query keys include the host id.
- **Crypto.** Only `packages/crypto` touches cryptographic primitives; the relay never sees
  plaintext (SEC13), and an E2E scenario checks it.
- **Protocol.** `packages/protocol` is the contract. Add commands there first; `tsc` then tells you
  every handler and caller to update. Changes are additive.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm relay && pnpm agentdeck daemon   # run the stack locally (cp .env.example .env first; see README)
pnpm test:e2e        # real daemon + CLI + scripted agent
pnpm e2e:record      # same, rendered to artifacts/e2e.mp4
RELAY_WORKER_TESTS=1 pnpm --filter @agentdeck/relay test   # relay contract tests on the Worker too
pnpm knip            # unused files, exports, dependencies
pnpm audit --audit-level high   # exceptions are reviewed in docs/rules/security.md
pnpm --filter @agentdeck/mobile test        # app unit tests (jest-expo)
pnpm --filter @agentdeck/mobile export:web  # app web build
pnpm test:e2e:app    # the app's web build (dev sign-in) in Chromium against two daemons + relay
```

The pre-commit hook runs lint-staged and `pnpm typecheck`; never bypass it with `--no-verify`.

A change is done when all of those pass. Don't disable a lint rule to get there; if an exception
is truly needed, use `// eslint-disable-next-line <rule> -- reason: …`.
