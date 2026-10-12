# Agentdeck

**Drive the coding agents running on your machine from your phone.**

Agentdeck runs `claude`, `codex`, `gemini` and other ACP-speaking agents on your own
computer, each task in its own git worktree, and lets you start tasks, answer permission
prompts, read diffs, browse files, open a live preview and ship a PR from an iOS, Android
or web app. Your code, your agent subscriptions and your credentials stay on your machine;
the relay in between only ever sees encrypted frames.

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

**Phase 1 (daemon core) is built**, and **Phase 2a** (end-to-end encrypted pairing, the relay and
the daemon's relay transport) is too: a phone can pair through the relay and drive the daemon,
with every frame sealed end to end. The app itself (Phase 2b) is next. 12 end-to-end scenarios and
the unit, contract and lint-rule tests pass on every push; see [`docs/phase-1.md`](docs/phase-1.md)
and [`docs/phase-2.md`](docs/phase-2.md).

| Phase | What | State |
|---|---|---|
| 0 | Spikes: kill the three biggest unknowns | partly done, see [`docs/spikes.md`](docs/spikes.md) |
| 1 | Daemon core, usable from a local CLI client | ✅ built |
| 2 | Relay, crypto, mobile MVP — the phone becomes the daily driver | 2a ✅ built (relay, crypto, pairing); 2b (app) next |
| 3 | Review, code, preview — judge an agent's work without a laptop | |
| 4 | Multi-account power features and public launch | |
| 5 | After launch: teams, parallel compare, voice, E2E preview, terminal | |

Each phase has a task checklist and acceptance criteria in the spec, written so it can be
handed to a coding agent as a standalone unit.

## Develop

Needs Node 22+, pnpm 10 and git.

```sh
pnpm install
pnpm build
pnpm test          # unit tests
pnpm test:e2e      # end-to-end: real daemon + CLI + scripted ACP agent
pnpm e2e:record    # same run, rendered to artifacts/e2e.mp4 (needs ffmpeg + Chromium)
pnpm lint && pnpm typecheck   # strict lint (structure, naming, library wrappers) and tsc
pnpm knip          # no unused files, exports or dependencies
pnpm --filter @agentdeck/mobile start   # Expo app skeleton (web: export:web)
```

The coding rules every change follows live in [`docs/rules/`](docs/rules/README.md) and are
summarised for agents in [`CLAUDE.md`](CLAUDE.md). A pre-commit hook (husky + lint-staged) runs
lint, Prettier and the typecheck; CI adds knip, `pnpm audit` and CodeQL.

Try it by hand with the scripted agent:

```sh
export AGENTDECK_HOME=/tmp/agentdeck AGENTDECK_DEV_AGENTS=1
node apps/cli/dist/main.js daemon &
node apps/cli/dist/main.js dev watch &
node apps/cli/dist/main.js repo add ~/src/my-repo
node apps/cli/dist/main.js profile add fake --name Personal
```

## Docs

- [`docs/rules/`](docs/rules/README.md) — typing, naming, structure, library-call, React,
  data, security and testing rules, each tagged with what enforces it
- [`docs/phase-1.md`](docs/phase-1.md) — what Phase 1 built, its E2E suite and the video
- [`docs/phase-2.md`](docs/phase-2.md) — Phase 2: relay, crypto and pairing (2a), the app (2b)
- [`docs/relay-deploy.md`](docs/relay-deploy.md) — deploying the relay to Cloudflare or self-hosting it
- [`docs/spikes.md`](docs/spikes.md) — pinned versions and open Phase 0 questions
- [`docs/tech-spec.md`](docs/tech-spec.md) — technical specification and implementation
  plan: protocol, data model, daemon, chat lifecycle, relay, pairing and encryption,
  preview tunnelling, mobile app, packaging, testing, phases, open questions. Snapshot of
  the [Agentdeck spec doc](https://claude.ai/artifact/E9gkgcyhW2XNyMYmtFYBq1), which stays
  the source of truth.

## License

Currently [MIT](LICENSE). The spec's default for launch is Apache-2.0 for the daemon and
protocol and AGPL for the relay, to be decided before open-sourcing in Phase 4.
