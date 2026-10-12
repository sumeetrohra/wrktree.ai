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
  the unencrypted `wake` flag, device names, account emails, and public keys. It never
  holds a key that opens a frame: each phone connection runs a signed X25519 handshake, frames are
  XChaCha20-Poly1305-sealed with the routing header (`from`, `to`, `seq`, session id) as additional
  data, and a replayed or reordered `seq` is rejected. A forged frame, or one the relay redirected,
  fails to open. An E2E scenario dumps the relay's database, log and wire traffic after a chat and
  checks that no prompt, file or reply text appears.
- **Login is the trust root (Phase 2c).** Phones and browsers sign in with Firebase Auth; the relay
  verifies the ID token. A computer joins an account when a signed-in device approves the code
  `agentdeck login` shows (only the computer holding the key it registered with can collect the
  token). Every host then trusts exactly the devices on the account's list on the relay, with the
  signing keys listed there. This replaced QR pairing with its short-code check, and it trades
  something away, plainly: frames stay end-to-end encrypted, so the network and the relay's storage
  still learn nothing, but **whoever controls the account, or a malicious relay that adds its own
  device to the list, can open sessions with your computers.** Protect the sign-in account (2FA on
  the identity provider) and run a relay you trust.
- Approving a code links whichever computer showed it: approve only a code your own computer shows.
- The daemon's identity key is sealed with a secret kept in the OS keystore (Keychain, DPAPI,
  libsecret), falling back to a `0600` file with a warning when none is available.
- Removing a device (from the app with the signed-in account, or with `agentdeck devices revoke` on
  a linked computer) deletes it and its token on the relay, which drops its sockets, push token and
  buffered frames; every host drops its session on its next refresh of the device list. A removed
  phone may sign in again, which is what signing in means.

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
| SEC13 | Everything between a consumer (phone, browser) and a host after the signed handshake is end-to-end encrypted and bound to its routing header; the relay stores and logs no plaintext. | `test:e2e` |
| SEC14 | Pushes carry a fixed body and no content; at most one per device every 30 s. | `test` |
| SEC15 | Relay device tokens are random and stored hashed; accounts come only from verified ID tokens (Firebase in production; the dev issuer and the Auth emulator only with `RELAY_DEV=1`); every device, computers included, registers with an ID token; device ids are derived from the device's signing key and proven at registration. | `test` |
| SEC16 | Account commands that hand out secrets (`account.link`, `account.logout`, `web.open`) are refused unless the client is local to the daemon; the deprecated `pair.*` commands always fail. | `review`, `test:e2e` |
| SEC17 | The desktop web UI page never contains the local token. `agentdeck open` gets a one-time code (60 s, single use) for the URL fragment; the page trades it with a same-origin POST. Pages are sent with `X-Frame-Options: DENY` and never serve files outside the web export. | `test` |
| SEC18 | On the phone, the identity key, the relay device token and the sign-in refresh token live in the keychain (`expo-secure-store`); only the web build falls back to `localStorage`. On a computer, the relay device token is sealed with the identity's secret (`relay-token.sealed`, 0600). | `review` |
| SEC19 | Cloud chat history is plaintext in Firebase, readable by Google and the project's admins, never by the relay. Firestore and Storage rules allow a user only `users/{uid}/…` (another account gets 403); Storage objects stay under 50 MB. On a computer, the Firebase refresh token is sealed with the relay device token (`relay-token.sealed`, 0600). | `test` (emulator), `test:e2e` |

## Pinned transitive fixes (SEC11)

When a fixed release exists but a direct dependency still pins the vulnerable one, the fix is forced
with a `pnpm.overrides` entry in the root `package.json` and listed here. Drop the entry once the
parent ships the fix.

| Override | Parent | Advisory |
|---|---|---|
| `miniflare>undici` → 7.29.1 | `wrangler` 4.141.0 (dev only) | GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3 |
| `miniflare>sharp` → 0.35.5 | `wrangler` 4.141.0 (dev only) | GHSA-wq5f-xc86-pv6w |
| `get-uri>basic-ftp` → 6.2.3 | `firebase-tools` 15.33.0 (dev only: the emulators) | GHSA-c475-qrg2-pj4r |

## Reviewed audit exceptions (SEC11)

`pnpm audit --audit-level high` runs in CI. An advisory may be ignored only when no fixed release
exists and the vulnerable code never handles untrusted input in shipped code. Each one is listed in
`pnpm-workspace.yaml` by GHSA id and here, and re-checked whenever its parent package is upgraded.

| Advisory | Package (path) | Why it is accepted |
|---|---|---|
| GHSA-86w9-cpqp-85rv | node-forge (expo → @expo/cli) | Used by the Expo dev CLI for local dev-server certificates; not bundled into the app or the daemon. No fixed release. |
| GHSA-vfj7-8cjw-p6xm | braces (eslint-plugin-check-file → micromatch) | Only expands the glob patterns in our own lint config. No fixed release. |
