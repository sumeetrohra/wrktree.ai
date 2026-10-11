# Security

## Trust model

- The daemon runs as you, on your machine. Anything it starts (agents, setup scripts) has your
  user's rights. It is not a sandbox; the path jail protects against *mistakes and prompt-injected
  agents asking the daemon to step outside a worktree*, not against code the agent runs itself.
- Adding a repo is an explicit trust decision: its `.agentdeck/config.json` setup and teardown
  scripts will run. They are read from the repo's main checkout, never from a worktree an agent
  edits.
- The local transport listens on `127.0.0.1` only and requires the token in `local-token`
  (mode `0600`, inside a `0700` home folder). Browsers can reach localhost, so the daemon also checks
  `Origin` and `Host`.
- Phase 2's relay sees routing metadata only; message bodies are end-to-end encrypted.

## Rules

| Id | Rule | Enforced by |
|---|---|---|
| SEC1 | Validate every inbound value with zod at the boundary (frames, ACP content, config, files, argv, env). | `review`, `test` |
| SEC2 | Every path from a client or an agent goes through the worktree's `FileJail` (realpath, must stay inside, `.git` and secret globs hidden). | `test` |
| SEC3 | The local token travels in the `Authorization` header (or `Sec-WebSocket-Protocol`), never in a URL. | `test` |
| SEC4 | WebSocket upgrades with a foreign `Origin`, or a `Host` other than `127.0.0.1:<port>` / `localhost:<port>`, are rejected (DNS-rebinding and drive-by protection). | `test` |
| SEC5 | Values passed to `git` that come from clients (branch, base ref, paths) are validated: no leading `-`, `check-ref-format` for refs, `--` before paths. | `test` |
| SEC6 | Child processes get an allow-listed environment (OS essentials + profile env + `AGENTDECK_*`), never the daemon's full environment. | `test` |
| SEC7 | `shell: true` is used only in `infra/process` to run a repo's setup/teardown scripts. | `lint:no-restricted-syntax`, `review` |
| SEC8 | Never log message text, file contents, diffs, tokens or keys. Log ids, codes and durations. | `test`, `review` |
| SEC9 | Every connection is resource-limited: frame size, frame rate, pending upload bytes. | `test` |
| SEC10 | No secrets in the repo; `.env*` stays ignored. | `CI`, `review` |
| SEC11 | Dependencies are pinned, installed with `--frozen-lockfile`, only allow-listed packages may run install scripts, and `pnpm audit --audit-level high` must pass. | `CI` |
| SEC12 | CodeQL runs on every push to `main` and every PR. | `CI` |
