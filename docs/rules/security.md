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
- The relay (Phase 2) is a mailbox, not a trusted party. It sees device ids, frame sizes and times,
  the unencrypted `wake` flag, pairing ids, device names a phone chose, and public keys. It never
  holds a key that opens a frame: each phone connection runs a signed X25519 handshake, frames are
  XChaCha20-Poly1305-sealed with the routing header (`from`, `to`, `seq`, session id) as additional
  data, and a replayed or reordered `seq` is rejected. A forged frame, or one the relay redirected,
  fails to open. An E2E scenario dumps the relay's database, log and wire traffic after a chat and
  checks that no prompt, file or reply text appears.
- Pairing needs the QR secret (an HMAC over the phone's keys proves the phone saw the code), the
  daemon's signature (the phone checks it against the key in the QR code), and the user's
  confirmation that both screens show the same six-digit code.
- The daemon's identity key is sealed with a secret kept in the OS keystore (Keychain, DPAPI,
  libsecret), falling back to a `0600` file with a warning when none is available.
- Revoking a device needs a paired daemon's signature, so a stolen account session alone can't
  cut off or impersonate devices. The daemon refuses a revoked device at once; the relay drops its
  sockets, push token and buffered frames.

## Rules

| Id | Rule | Enforced by |
|---|---|---|
| SEC1 | Validate every inbound value with zod at the boundary (frames, ACP content, config, files, argv, env). | `review`, `test` |
| SEC2 | Every path from a client or an agent goes through the worktree's `FileJail` (realpath, must stay inside, `.git` and secret globs hidden). | `test` |
| SEC3 | The local token travels in the `Authorization` header (or `Sec-WebSocket-Protocol`), never in a URL. | `test` |
| SEC4 | WebSocket upgrades with a foreign `Origin`, or a `Host` other than `127.0.0.1:<port>` / `localhost:<port>`, are rejected (DNS-rebinding and drive-by protection). The only exception is an origin listed in `AGENTDECK_DEV_ORIGINS`, for development. | `test` |
| SEC5 | Values passed to `git` that come from clients (branch, base ref, paths) are validated: no leading `-`, `check-ref-format` for refs, `--` before paths. | `test` |
| SEC6 | Child processes get an allow-listed environment (OS essentials + profile env + `AGENTDECK_*`), never the daemon's full environment. | `test` |
| SEC7 | `shell: true` is used only in `infra/process` to run a repo's setup/teardown scripts. | `lint:no-restricted-syntax`, `review` |
| SEC8 | Never log message text, file contents, diffs, tokens or keys. Log ids, codes and durations. | `test`, `review` |
| SEC9 | Every connection is resource-limited: frame size, frame rate, pending upload bytes. | `test` |
| SEC10 | No secrets in the repo; `.env*` stays ignored. | `CI`, `review` |
| SEC11 | Dependencies are pinned, installed with `--frozen-lockfile`, only allow-listed packages may run install scripts, and `pnpm audit --audit-level high` must pass. | `CI` |
| SEC12 | CodeQL runs on every push to `main` and every PR. | `CI` |
| SEC13 | Everything after pairing between a phone and the daemon is end-to-end encrypted and bound to its routing header; the relay stores and logs no plaintext. | `test:e2e` |
| SEC14 | Pushes carry a fixed body and no content; at most one per device every 30 s. | `test` |
| SEC15 | Relay tokens are random and stored hashed; account sessions are short-lived signed JWTs; device ids are derived from the device's signing key and proven at registration. | `test` |
| SEC16 | Pairing commands (`pair.*`) are refused unless the client is local to the daemon. | `review`, `test:e2e` |

## Pinned transitive fixes (SEC11)

When a fixed release exists but a direct dependency still pins the vulnerable one, the fix is forced
with a `pnpm.overrides` entry in the root `package.json` and listed here. Drop the entry once the
parent ships the fix.

| Override | Parent | Advisory |
|---|---|---|
| `miniflare>undici` → 7.29.1 | `wrangler` 4.141.0 (dev only) | GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3 |
| `miniflare>sharp` → 0.35.5 | `wrangler` 4.141.0 (dev only) | GHSA-wq5f-xc86-pv6w |

## Reviewed audit exceptions (SEC11)

`pnpm audit --audit-level high` runs in CI. An advisory may be ignored only when no fixed release
exists and the vulnerable code never handles untrusted input in shipped code. Each one is listed in
`pnpm-workspace.yaml` by GHSA id and here, and re-checked whenever its parent package is upgraded.

| Advisory | Package (path) | Why it is accepted |
|---|---|---|
| GHSA-86w9-cpqp-85rv | node-forge (expo → @expo/cli) | Used by the Expo dev CLI for local dev-server certificates; not bundled into the app or the daemon. No fixed release. |
| GHSA-vfj7-8cjw-p6xm | braces (eslint-plugin-check-file → micromatch) | Only expands the glob patterns in our own lint config. No fixed release. |
