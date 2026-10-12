# Phase 0 spikes

What Phase 1 needed from Phase 0, and what is still open.

## Pinned versions

| Package | Version | Used by |
|---|---|---|
| `@agentclientprotocol/sdk` | 1.8.0 | daemon (ACP client), fake agent (ACP agent) |
| `@zed-industries/claude-agent-acp` | 0.23.1 | `claude` agent spec (launched with `npx -y`) |
| `@zed-industries/codex-acp` | 0.16.0 | `codex` agent spec |
| `better-sqlite3` | 13.0.3 | daemon storage (SQLite 3.53) |
| `@vscode/ripgrep` | 1.18.0 | `fs.search` (falls back to `rg` on `PATH`) |
| Node | 22 LTS | everything |
| `@noble/curves`, `@noble/ciphers`, `@noble/hashes` | 2.4.0 | `packages/crypto` |
| `hono` / `@hono/node-server` | 4.13.9 / 2.1.1 | relay API, self-host server |
| `jose` | 6.2.12 | relay account sessions |
| `wrangler` | 4.141.0 | relay Worker build and local Durable Objects |

## Answered

- **ACP shape.** The SDK's `ClientSideConnection` / `AgentSideConnection` over `ndJsonStream`
  covers everything Phase 1 uses: `initialize`, `session/new`, `session/load`, `session/prompt`,
  `session/cancel`, `session/update`, `session/request_permission`, `fs/read_text_file`,
  `fs/write_text_file`. Updates arrive as `agent_message_chunk`, `agent_thought_chunk`,
  `tool_call`, `tool_call_update` and `plan`; the mapper handles those and ignores the rest.
- **Images.** Prompts carry images as `{ type: "image", mimeType, data }` content blocks; the
  agent advertises `promptCapabilities.image`.
- **Native addons.** `better-sqlite3` and `@vscode/ripgrep` install from prebuilt binaries on
  Linux; CI checks macOS and Windows.

- **Durable Objects.** Two hibernating WebSockets in one SQLite-backed Durable Object, forwarding
  and storing frames, run under `wrangler dev`; the relay contract tests (`RELAY_WORKER_TESTS=1`)
  exercise the real hub on it. `@cloudflare/vitest-pool-workers` needs Vitest 4, so the tests drive
  `wrangler dev` as a child process instead.
- **Phone crypto.** `react-native-libsodium` 1.7 exposes no `crypto_kx_*` and no scalar
  multiplication, so it can't do the spec's key exchange. `packages/crypto` uses `@noble/curves`,
  `@noble/ciphers` and `@noble/hashes` on every platform, and a test proves the output matches
  libsodium (`libsodium-wrappers-sumo` 0.8.4) byte for byte. No native module is needed.

## Still open (needs a real machine and real accounts)

| Question | Default until answered |
|---|---|
| Does Claude Code keep separate credentials per `CLAUDE_CONFIG_DIR` on macOS (Keychain)? | Assume yes; `loginStatus` for claude checks `.credentials.json`, which is a best effort on macOS |
| Do `claude-agent-acp` and `codex-acp` advertise `loadSession`? | If not, the daemon starts a fresh session seeded with the last 20 messages and marks the chat "resumed" (implemented) |
| Event shapes: claude vs codex diff | Re-run the nightly smoke test once test accounts exist |
