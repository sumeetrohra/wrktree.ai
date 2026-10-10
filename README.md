# Agentdeck

**Drive the coding agents running on your machine from your phone.**

Agentdeck runs `claude`, `codex`, `gemini` and other ACP-speaking agents on your own
computer, each task in its own git worktree, and lets you start tasks, answer permission
prompts, read diffs, browse files, open a live preview and ship a PR from an iOS, Android
or web app. Your code, your agent subscriptions and your credentials stay on your machine;
the relay in between only ever sees encrypted frames.

> This repo started as **wrktree**, a VS Code extension for parallel agent worktrees. That
> plan is superseded; its PRD and Phase 0 study live in [`docs/archive/`](docs/archive/).

## How it fits together

One TypeScript monorepo builds three deployables that share one protocol package:

| Deployable | Runs on | Job |
|---|---|---|
| **Daemon** (`apps/daemon`) | Your machine (Node 22) | Owns repos, worktrees, agent sessions over ACP, git, files, previews. SQLite + append-only JSONL event logs. |
| **Relay** (`apps/relay`) | Cloudflare Workers + Durable Objects (self-host: Node + Docker) | A dumb, durable mailbox: one Durable Object per account forwards sealed frames, buffers for offline devices, sends content-free push wake-ups. |
| **App** (`apps/mobile`) | iOS, Android, web (Expo) | Thin, cache-first client. The web build doubles as the desktop UI, served by the daemon on localhost. |

Phone and daemon pair by QR code and talk end-to-end encrypted (libsodium X25519 +
XChaCha20-Poly1305, per-connection ephemeral keys). Multiple agent accounts are first-class
"profiles" (isolated `CLAUDE_CONFIG_DIR` / `CODEX_HOME`), with hand-off to another profile
when one hits its usage limit.

## Status

Design complete; no product code yet. Next up is **Phase 0: spikes** — multi-account
credential isolation, an ACP client against `claude-agent-acp` and `codex-acp`, a Durable
Object WebSocket hello world, and cross-platform libsodium.

| Phase | What | Rough timing |
|---|---|---|
| 0 | Spikes: kill the three biggest unknowns | 2 evenings — **next** |
| 1 | Daemon core, usable from a local CLI client | weeks 1–3 |
| 2 | Relay, crypto, mobile MVP — the phone becomes the daily driver | weeks 4–7 |
| 3 | Review, code, preview — judge an agent's work without a laptop | weeks 8–10 |
| 4 | Multi-account power features and public launch | weeks 11–14 |
| 5 | After launch: teams, parallel compare, voice, E2E preview, terminal | — |

Each phase has a task checklist and acceptance criteria in the spec, written so it can be
handed to a coding agent as a standalone unit.

## Docs

- [`docs/tech-spec.md`](docs/tech-spec.md) — technical specification and implementation
  plan: protocol, data model, daemon, chat lifecycle, relay, pairing and encryption,
  preview tunnelling, mobile app, packaging, testing, phases, open questions. Snapshot of
  the [Agentdeck spec doc](https://claude.ai/artifact/E9gkgcyhW2XNyMYmtFYBq1), which stays
  the source of truth.
- [`docs/archive/`](docs/archive/) — the superseded wrktree VS Code extension PRD and
  Phase 0 reference study.

## License

Currently [MIT](LICENSE). The spec's default for launch is Apache-2.0 for the daemon and
protocol and AGPL for the relay, to be decided before open-sourcing in Phase 4.
