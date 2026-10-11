# Library calls

Each third-party library that talks to the outside world (disk, network, processes, SDKs) is
imported in exactly one wrapper. Everything else calls the wrapper's typed API. This keeps error
handling, validation, logging and security policy in one place per library, and makes swapping a
library a one-file change.

| Id | Library | Only imported in | Enforced by |
|---|---|---|---|
| L1 | `better-sqlite3` | `apps/daemon/src/infra/db/` | `lint:no-restricted-imports` |
| L2 | `@agentclientprotocol/sdk` | `apps/daemon/src/infra/acp/`, `tools/fake-agent/` | `lint:no-restricted-imports` |
| L3 | `ws`, `node:http` | `apps/daemon/src/infra/transport/`, `apps/cli/src/lib/daemon-client/` | `lint:no-restricted-imports` |
| L4 | `node:child_process` | `apps/daemon/src/infra/process/`, `apps/cli/src/lib/process/`, `tools/`, `e2e/` | `lint:no-restricted-imports` |
| L5 | `@vscode/ripgrep` | `apps/daemon/src/infra/search/` | `lint:no-restricted-imports` |
| L6 | `pino` | `apps/daemon/src/infra/log/` | `lint:no-restricted-imports` |
| L7 | `dayjs` | `apps/mobile/src/shared/utils/datetime-utils.ts` | `lint:no-restricted-imports` |
| L8 | `@sentry/react-native` | `apps/mobile/src/modules/sentry/` | `lint:no-restricted-imports` |
| L9 | `WebSocket`, `fetch` globals | `apps/mobile/src/lib/api/` | `lint:no-restricted-globals` |
| L10 | `react-native` primitives that have a design-system equivalent (`Pressable`, `TextInput`, `Text`, `Button`, `Switch`) | `apps/mobile/src/shared/components/ui/` | `lint:no-restricted-imports` |

Adding a new I/O library means adding a wrapper and a row here in the same change (L11, `review`).
