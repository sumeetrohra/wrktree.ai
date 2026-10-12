# Library calls

Each third-party library that talks to the outside world (disk, network, processes, SDKs) is
imported in exactly one wrapper. Everything else calls the wrapper's typed API. This keeps error
handling, validation, logging and security policy in one place per library, and makes swapping a
library a one-file change.

| Id | Library | Only imported in | Enforced by |
|---|---|---|---|
| L1 | `better-sqlite3` | `apps/daemon/src/infra/db/`, `apps/relay/src/infra/sql/` | `lint:no-restricted-imports` |
| L2 | `@agentclientprotocol/sdk` | `apps/daemon/src/infra/acp/`, `tools/fake-agent/` | `lint:no-restricted-imports` |
| L3 | `ws`, `node:http` | `apps/daemon/src/infra/transport/`, `apps/daemon/src/infra/relay/`, `apps/relay/src/infra/node/`, `apps/cli/src/lib/daemon-client/` | `lint:no-restricted-imports` |
| L4 | `node:child_process` | `apps/daemon/src/infra/process/`, `apps/cli/src/lib/process/`, `tools/`, `e2e/` | `lint:no-restricted-imports` |
| L5 | `@vscode/ripgrep` | `apps/daemon/src/infra/search/` | `lint:no-restricted-imports` |
| L6 | `pino` | `apps/daemon/src/infra/log/` | `lint:no-restricted-imports` |
| L7 | `dayjs` | `apps/mobile/src/shared/utils/datetime-utils.ts` | `lint:no-restricted-imports` |
| L8 | `@sentry/react-native` | `apps/mobile/src/modules/sentry/` | `lint:no-restricted-imports` |
| L9 | `WebSocket`, `fetch` globals | `apps/mobile/src/lib/api/` | `lint:no-restricted-globals` |
| L23 | `fetch` for signing in (Firebase Auth REST, the relay's dev issuer) | `apps/mobile/src/lib/auth/` | `lint:no-restricted-globals` |
| L11 | `@noble/curves`, `@noble/ciphers`, `@noble/hashes`, `libsodium-wrappers-sumo` | `packages/crypto/src/` (everything else calls `@agentdeck/crypto`) | `lint:no-restricted-imports` |
| L12 | `hono`, `@hono/node-server` | `apps/relay/src/app/`, `apps/relay/src/infra/node/` | `lint:no-restricted-imports` |
| L13 | `jose` | `apps/relay/src/infra/idtoken/` | `lint:no-restricted-imports` |
| L14 | `qrcode-terminal` | `apps/cli/src/shared/output/` | `lint:no-restricted-imports` |
| L15 | `cloudflare:workers` | `apps/relay/src/app/worker-host.ts`, `apps/relay/src/infra/worker/` | `lint:no-restricted-imports` |
| L16 | `react-native-mmkv` | `apps/mobile/src/lib/storage/` | `lint:no-restricted-imports` |
| L17 | `expo-secure-store` | `apps/mobile/src/lib/secure-store/` | `lint:no-restricted-imports` |
| L18 | `expo-notifications` | `apps/mobile/src/lib/notifications/` | `lint:no-restricted-imports` |
| L19 | `expo-camera` | `apps/mobile/src/lib/camera/` | `lint:no-restricted-imports` |
| L20 | `expo-image-picker`, `expo-clipboard` | `apps/mobile/src/lib/media/` | `lint:no-restricted-imports` |
| L21 | `expo-haptics`, `expo-device` | `apps/mobile/src/lib/device/` | `lint:no-restricted-imports` |
| L22 | `expo-crypto` | `apps/mobile/src/lib/api/` (the `getRandomValues` polyfill for Hermes) | `lint:no-restricted-imports` |
| L10 | `react-native` primitives that have a design-system equivalent (`Pressable`, `TextInput`, `Text`, `Button`, `Switch`) | `apps/mobile/src/shared/components/ui/` | `lint:no-restricted-imports` |

A row covers the library's subpath imports too (`@noble/hashes/sha2.js`, `dayjs/plugin/…`).

Adding a new I/O library means adding a wrapper and a row here in the same change (`review`), plus
a case in `tools/lint-fixtures` proving the rule fires (`test`).
