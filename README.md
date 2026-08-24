# wrktree

**Run your coding agents in parallel, inside VS Code.**

A VS Code sidebar where each row is a task being worked on by an agent, backed by a git
worktree, showing live agent state — `idle`, `running`, `waiting-input`, `done`, `failed`.
Click a row and the whole window re-points at that worktree. No reload, no new window,
no app switching.

wrktree is agent-agnostic. It never ships an agent of its own; it drives the CLI you
already use — `claude`, `codex`, and whatever comes next — through a thin adapter
interface, so your existing subscription, config, MCP servers, and hooks keep working.

## Why

Running four coding agents in parallel means four isolated contexts. Today every option
asks you to either leave your editor (Conductor, Superset, Pane) or adopt someone else's
agent (Agent HQ, Pochi, Kilo). The existing VS Code worktree extensions are git tools —
they list and switch worktrees, but none of them know whether an agent is running in one,
blocked waiting for your input, or finished twenty minutes ago.

That missing layer — agent-session state as the primary object, worktrees as the
substrate, in-place window switching as the mechanic — is what wrktree is.

## Status

Pre-Phase 0. Nothing is built yet. The plan lives in [`docs/prd.md`](docs/prd.md).

Roadmap at a glance:

| Phase | What |
|---|---|
| 0 | Reference study — reuse, native VS Code coverage, structured CLI output |
| 1 | Worktree switching MVP — sidebar + in-place window swap |
| 1.5 | Git state enrichment via the built-in `vscode.git` API |
| 2 | **Agent sessions** — multi-chat per worktree, live agent state on rows |
| 3 | PR wiring — thin, delegating to the GitHub Pull Requests extension |
| 4 | Polish — status bar, settings, command palette parity |

Phase 1 is table stakes. Phase 2 is where wrktree actually starts.

## Non-goals

Local-only: no cloud sandboxes, no multiplayer, no mobile. No agent of our own. No custom
diff UI, terminal UI, or worktree-CRUD UI — VS Code already has those. No monetization;
this ships MIT as a personal/OSS tool.

## Docs

- [`docs/prd.md`](docs/prd.md) — product requirements, competitive analysis, phased plan

## License

[MIT](LICENSE)
