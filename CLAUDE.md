# Agentdeck — guide for coding agents

Agentdeck lets you drive coding agents (Claude Code, Codex, Gemini) running on your machine from
your phone. Read [`docs/tech-spec.md`](docs/tech-spec.md) for the design and
[`docs/phase-1.md`](docs/phase-1.md) for what exists.

## Before you change anything

The rules in [`docs/rules/`](docs/rules/README.md) are mandatory; most are enforced by lint and
the type checker. The ones that most often matter:

- **Layers.** Modules never import other modules. Pages (app) and handlers (daemon) compose them.
  A module that needs something declares a port (`I…` interface) in its `.types.ts`.
- **Library wrappers.** `better-sqlite3`, the ACP SDK, `ws`, `child_process`, ripgrep, pino, dayjs,
  Sentry and `fetch`/`WebSocket` are each imported in exactly one wrapper.
- **Types.** No `any`, no `!`, no `as` (except `as const`). Parse untrusted data with zod.
  Types are `TFoo`, interfaces `IFoo`, schemas `fooSchema`.
- **Files.** kebab-case, with a purpose suffix (`.service.ts`, `.types.ts`, `.schema.ts`,
  `.handlers.ts`, `.store.ts`, `.queries.ts`, `.test.ts`).
- **React.** No `useEffect`, no Context, no `useMemo`/`useCallback`/`memo`. Server state in React
  Query, client state in Zustand, UI from React Native Reusables, strings through i18n.
- **Protocol.** `packages/protocol` is the contract. Add commands there first; `tsc` then tells you
  every handler and caller to update. Changes are additive.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e        # real daemon + CLI + scripted agent
pnpm e2e:record      # same, rendered to artifacts/phase-1-e2e.mp4
```

A change is done when all of those pass. Don't disable a lint rule to get there; if an exception
is truly needed, use `// eslint-disable-next-line <rule> -- reason: …`.
