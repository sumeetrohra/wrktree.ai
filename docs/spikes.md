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

## Still open (needs a real machine and real accounts)

| Question | Default until answered |
|---|---|
| Does Claude Code keep separate credentials per `CLAUDE_CONFIG_DIR` on macOS (Keychain)? | Assume yes; `loginStatus` for claude checks `.credentials.json`, which is a best effort on macOS |
| Do `claude-agent-acp` and `codex-acp` advertise `loadSession`? | If not, the daemon starts a fresh session seeded with the last 20 messages and marks the chat "resumed" (implemented) |
| Event shapes: claude vs codex diff | Re-run the nightly smoke test once test accounts exist |
| Durable Object hello world, `react-native-libsodium` ↔ Node decrypt | Phase 2 |
