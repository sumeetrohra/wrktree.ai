# Phase 1 — Daemon core

> Status: **built**. Everything in the tech spec's Phase 1 works from a local CLI client, with no
> relay and no app. 7 end-to-end scenarios and 67 unit tests pass; `pnpm e2e:record` renders a
> video walkthrough of the E2E run.

Goal (from [`tech-spec.md`](tech-spec.md#phase-1-daemon-core-weeks-1-3)): everything works from a
local CLI client with no relay and no app.

## What exists

```
packages/shared/     prefixed ULIDs, time, Result, logger interface
packages/protocol/   zod schemas: envelope, commands, events, errors, models + fixtures
apps/daemon/         router, event bus, SQLite, local transport, modules (below)
apps/cli/            `agentdeck` CLI + the WebSocket client library
tools/fake-agent/    scripted ACP agent (real ACP over stdio, no tokens)
e2e/                 harness, 7 scenarios, recorder + video player
```

Daemon modules, all behind one command router:

| Module | Does |
|---|---|
| `router.ts` | zod validation, idempotency by `CmdId` (24 h, survives restarts), uniform `ProtocolError`s |
| `bus.ts` | one append-only JSONL log per topic; cursor = line number; replay then live |
| `transports/local.ts` | `127.0.0.1` HTTP + WebSocket, token in a 0600 file, replay on `sync.hello`, blob framing (> 64 KB, 256 KB parts) |
| `modules/repos.ts` | add/remove inside the allow-list, `.agentdeck/config.json`, `fs.browse` |
| `modules/profiles.ts` | isolated config folder per agent account, shared folder linking, login status/command |
| `modules/worktrees.ts` | `git worktree add`, setup/teardown scripts with `AGENTDECK_*` env, port pool, archive/restore/delete |
| `modules/files.ts` | realpath jail, hidden `.git` + secret globs, tree, chunked read, ripgrep search, ACP fs requests |
| `modules/git.ts` | diff summary (incl. untracked files) and per-file unified diff as a blob |
| `modules/sessions/*` | agent registry, ACP client, update → chat item mapper (≤ 20 patches/s), permission broker, lifecycle state machine with restart + `session/load` resume |

CLI:

```
agentdeck daemon                              run the daemon in the foreground
agentdeck repo add <path>
agentdeck profile add <agent> --name <name>   create a profile and run its login
agentdeck dev send <command> ['<json>'] [--cmd-id cmd_…] [--json]
agentdeck dev watch [topic …] [--from <n>]    default: global repo:* chat:*
agentdeck dev blob <file> [--mime <type>]
```

`AGENTDECK_HOME` picks the data folder. `AGENTDECK_DEV_AGENTS=1` registers the `fake` agent.
`AGENTDECK_BROWSE_ROOTS` (path-list) sets the allow-list (default: your home folder).

## End-to-end tests

`pnpm test:e2e` builds everything, then runs each scenario against a fresh daemon in a temp
folder. Commands go through the real `agentdeck` binary as child processes; assertions read
events through a second client of the same local transport. The agent is
`tools/fake-agent`, a real ACP agent whose behaviour a prompt picks with `#script:<name>`.

| # | Scenario | Covers |
|---|---|---|
| 1 | Golden path | add a repo, two profiles, a worktree, one chat per profile, a prompt with an image, approve a permission, read the diff |
| 2 | Daemon crash & restart | `kill -9` mid-turn: chats come back via `session/load`, replay from any cursor equals the live stream, a repeated `CmdId` runs once |
| 3 | Path jail | `../`, absolute paths, symlink escapes, `.git`, `.env*` refused for clients and agents; hidden from tree and search |
| 4 | Chat lifecycle | queued sends, cancel, crash → auto-restart, give up after 3, retry, usage limit → `limited` → idle |
| 5 | Permissions | allow always remembered, deny + message, pending request survives a client disconnect |
| 6 | Worktree lifecycle | failing setup, port pool reuse, archive keeps work, restore restarts chats, delete removes folder and branch, allow-list |
| 7 | Streaming & payloads | itemPatch coalescing ≤ 20/s, a > 64 KB reply split into blob parts, ripgrep, multipart upload |

### The video

`pnpm e2e:record` runs the same scenarios under a recording sink, then replays the captured
terminals in `e2e/record/player.html` (xterm.js) inside headless Chromium with video on, and
writes `artifacts/phase-1-e2e.mp4`. Left pane: commands as typed and their output. Middle:
the live `agentdeck dev watch` stream. Right: assertions as they pass. Idle gaps are capped at
1.2 s and short pauses are added before each step so it can be followed. CI uploads the
video as the `phase-1-e2e-video` artifact.

## Deviations from the spec (all additive or deliberate)

- **Protocol additions:** `chat.list`, `chat.retry`, `profile.loginCommand`, `blob.get`; events
  `permission.resolved` and `worktree.removed`; `chat.status` carries `queued` and `resetAt`;
  `blob.put` takes the `uploadId` of the blob frames sent before it. `sync.hello` cursors accept
  `repo:*` / `chat:*` wildcards; an explicit topic key overrides a wildcard.
- **Migrations:** plain SQL with SQLite `user_version` instead of Drizzle; one fewer dependency
  for nine tables.
- **Archive keeps the folder:** archiving stops chats, runs teardown and frees the port, but
  leaves the worktree on disk so uncommitted work is never lost. Delete removes folder and branch.
- **Deny + message:** ACP has no message on a permission reply, so the message is queued as
  the next prompt after the agent ends its turn.
- **Not yet:** event-log rotation/compaction at 50 MB, and transcript-summary quality beyond
  "last 20 messages" for agents without `session/load`.

## Open items carried from Phase 0

See [`spikes.md`](spikes.md): Keychain isolation per `CLAUDE_CONFIG_DIR` on macOS, and whether
the real adapters support `session/load`, still need a real Mac and real accounts.
