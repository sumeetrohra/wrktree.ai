# Phase 2 — Relay, crypto, mobile MVP

Goal (from [`tech-spec.md`](tech-spec.md#phase-2-relay-crypto-mobile-mvp-weeks-4-7)): the phone
becomes the daily driver for chats.

Phase 2 ships in two milestones:

| Milestone | What | Status |
|---|---|---|
| **2a** | `packages/crypto`, the relay (Worker + self-host), the daemon's relay transport, pairing, `agentdeck pair / devices / relay / install` | **built** |
| **2b** | the app: onboarding, QR pairing, repos → worktrees → chats, chat screen, permission sheet, composer, push and deep links, offline cache; the desktop web UI | **built** (web-tested; native builds need EAS) |

## 2a: what exists

```
packages/crypto/   identity keys, pairing transcript, signed handshake, sealed frames, replay guard
apps/relay/        Hono API + account hubs; Cloudflare Worker + Durable Objects, and a Node build
apps/daemon/       infra/keystore, infra/relay, infra/transport/relay-transport, modules/devices, modules/pairing
apps/cli/          pair, devices, relay, install
e2e/               phone simulator + 5 relay scenarios (8–12)
```

### How a phone reaches the daemon

```
phone ──https──▶ relay  (sign in, register, claim the pairing id)
phone ══wss════▶ relay ══wss══▶ daemon   frames: { from, to, seq, sid, kind, body, wake? }
                  │                         body = XChaCha20-Poly1305(inner frame), AD = from|to|seq|sid
                  └─ buffers frames for an offline device, push-wakes a phone for `wake` frames
```

1. **Pairing.** `agentdeck pair` asks the relay for a one-time pairing id and prints a QR code
   (and the same `agentdeck://pair?o=…` link) carrying the relay URL, the pairing id, the daemon's
   device id and signing key, and a 32-byte secret. The phone signs in, claims the id (which moves
   the daemon onto the phone's account), and sends `pair.hello` with an HMAC made with the secret.
   The daemon checks it, replies with a signature over the pairing transcript, and both screens show
   the same six-digit code. The phone becomes usable once the user confirms on the desktop.
2. **Sessions.** Every phone connection starts with a signed ephemeral X25519 handshake, so a
   stolen long-term key can't decrypt past sessions. Behind each session sits the same `Connection`
   the local transport uses, so the phone has exactly the desktop's API.
3. **Offline.** The daemon's event log is the source of truth. Frames sealed under a session that
   has since ended are dropped; on reconnect the phone handshakes again and `sync.hello` replays
   from its cursors. Commands are idempotent by `CmdId`. While a phone is offline the daemon only
   sends frames that should wake it (permission requests, limits, crashes, end of turn), and the
   relay turns those into a content-free push.

### Decisions worth knowing

- **Crypto library.** `react-native-libsodium` has no `crypto_kx_*` or scalar multiplication, so
  the spec's key exchange can't run on the phone with it. `packages/crypto` uses the audited
  pure-JS `@noble/*` libraries everywhere (Node, web, React Native) and a test checks it byte for
  byte against libsodium (`crypto_kx_*_session_keys`, `crypto_aead_xchacha20poly1305_ietf_*`), so
  any libsodium peer interoperates. It also means the app needs no native crypto module.
- **One relay codebase, two hosts.** The directory and hub logic is written once against a small
  SQL port; the Worker runs it on Durable Object SQLite (WebSocket hibernation), the self-host build
  on better-sqlite3. The same contract tests run against both (`RELAY_WORKER_TESTS=1` adds the
  Worker under `wrangler dev`).
- **`relay.closed`.** Under `wrangler dev`, a server-initiated close on a hibernated socket isn't
  delivered promptly, so the relay sends a `relay.closed` control frame with the code first and
  clients close on it. Security doesn't depend on it: a removed member's frames are refused and
  nothing is routed to it.
- **Daemon without an account.** The daemon registers with its signing key alone and gets a
  placeholder account; claiming its pairing offer moves it onto the phone's account.
- **Local-only pairing.** `pair.*` commands are refused unless the client is on the daemon's machine.

### CLI

```
agentdeck relay set <url> | relay status   choose the relay (saved in config.json; AGENTDECK_RELAY_URL overrides)
agentdeck pair [--yes]                     QR code + link, wait for the phone, compare codes
agentdeck devices [revoke <id>]            list or revoke paired devices
agentdeck install [--dry-run]              launchd agent / systemd user unit / logon scheduled task
```

## End-to-end tests (2a)

`pnpm test:e2e` now also runs `e2e/src/phase2.test.ts`: the real daemon and CLI, a local relay
(the Node build, dev mode), and a phone simulator that does what the app will: sign in through the
dev outbox, claim, pair, handshake, and call the daemon only through sealed frames.

| # | Scenario | Covers |
|---|---|---|
| 8 | Pairing through the relay | QR link → claim → MAC'd hello → signed reply → matching short codes; a hello without the secret is rejected; an unconfirmed device gets no session; `pair.*` refused remotely |
| 9 | A whole task from the phone | worktree, chat, prompt, permission, approval, diff — all over the relay, no gaps |
| 10 | Phone offline while the agent works | one content-free push; reconnect replays every event in order; a repeated `CmdId` runs once |
| 11 | Tampering and revocation | flipped ciphertext, rewritten `seq` and replayed frames are dropped; `devices revoke` cuts the phone off and it can't come back |
| 12 | The relay never sees content | after a chat, a file read and an offline spell, the relay's database, log and wire traffic contain no prompt, file or reply text |

Unit and contract tests added: `packages/crypto` (16, including the libsodium cross-check),
relay contract (9 per host) and hub buffer tests (5), install-file generators (3).

`pnpm e2e:record` renders Phases 1 and 2 into `artifacts/e2e.mp4`.

## Try it by hand

```sh
pnpm build
RELAY_DEV=1 RELAY_JWT_SECRET=$(openssl rand -hex 32) node apps/relay/dist/main.node.js &
export AGENTDECK_HOME=/tmp/agentdeck AGENTDECK_DEV_AGENTS=1 AGENTDECK_RELAY_URL=http://127.0.0.1:8787
node apps/cli/dist/main.js daemon &
node apps/cli/dist/main.js pair
```

The app (2b, below) is the phone side; the 2a scenarios use a phone simulator (`e2e/src/phone-sim.ts`).

## 2b: the app

```
apps/mobile/src/
  app/                    routes: (onboarding)/pair, sign-in, confirm-code; (main)/index, repo/[repoId],
                          repo/[repoId]/new, wt/[worktreeId], wt/[worktreeId]/chat/[chatId], chat/[chatId],
                          devices, settings, wake
  pages/                  one page per route, plus pages/root (the shell that starts every module's sync)
  modules/                auth, pairing, machines, repos, worktrees, profiles, chats, permissions,
                          composer, devices
  lib/api/                RelayConnection (handshake, sealed frames, acks, offline queue, cursors),
                          LocalConnection (desktop web), pairing, relay HTTP API, connection store
  lib/{storage,secure-store,notifications,camera,media,device}   one wrapper per native library
```

- **Onboarding.** Scan the QR code (or paste its link) → sign in to that relay with an emailed code
  → the app claims the offer, sends `pair.hello`, checks the daemon's signature and shows the
  six-digit code → it connects as soon as the desktop confirms.
- **Chats.** A Zustand chat store per chat (items, order, status, pending permission, queued
  count), fed by daemon events and backed by MMKV (last 200 items), so a cold start shows the
  conversation at once. FlashList renders one component per `ChatItem.kind`; tool cards collapse.
- **Permission sheet** above the composer: Allow once, Always, Deny, Deny + message; a haptic when
  a request arrives. **Composer:** multiline input; attach from the library, the camera or the
  clipboard; queues while a turn runs.
- **Offline.** `chat.send`, `permission.respond` and `chat.cancel` queue in MMKV with their `CmdId`
  and run on reconnect. Every reconnect handshakes again and replays from the saved cursors; the
  status turns `online` only once the replay is applied. The web build also reacts to the browser's
  `offline`/`online` events.
- **Push.** After pairing the app registers its Expo push token with the relay. A tap opens
  `/wake`, which waits until the phone has caught up and opens the chat with the newest pending
  permission (the push itself carries nothing).
- **Revocation.** A revoked phone is told on its open socket (`relay.closed`) or, if it was away,
  finds out from `GET /v1/devices/me` on its next connect attempt, and shows a "removed" screen.
- **Desktop web.** With `AGENTDECK_WEB_ROOT=apps/mobile/dist`, the daemon serves the same app.
  `agentdeck open` opens it with a one-time code in the URL fragment, which the page trades for the
  local token (SEC17). It talks to the local transport directly: no relay, no crypto.

Decisions:

- **No native crypto module.** `packages/crypto` is pure JS (`@noble`), so pairing and sessions
  run the same code in Node, the browser and Hermes (with `expo-crypto` for random bytes).
- **Module sync at startup.** Expo Router loads routes lazily, so an event listener registered when
  a module is imported could miss events while the user is on another screen. Each module exposes
  `start…Sync()`, and `pages/root` calls them all at startup.

### End-to-end tests (2b)

`pnpm test:e2e:app` (CI job `app E2E`) builds the web export and drives it in a phone-sized
Chromium against the real daemon, CLI and relay:

| # | Scenario | Covers |
|---|---|---|
| 13 | The app: pair, run a task, go offline, get woken, get revoked | paste the link, sign in with the emailed code, matching codes; New task → streaming → permission sheet → Allow once → done; airplane mode → one content-free push → reconnect, catch up, approve; `/wake` opens the chat that needs the user; `agentdeck devices revoke` → "removed" screen |
| 14 | The desktop web UI, served by the daemon | `agentdeck open` → one-time link → repos over the local connection; the same link in another browser is refused |

`pnpm e2e:record` also renders these into `artifacts/app-e2e.mp4` (captioned per step and check).
Jest covers the chat store, patch application, item renderers, the permission sheet, branch
naming and the home page (11 tests). Maestro flows for a development build are in `e2e/maestro/`.

### Try the app

```sh
pnpm build && pnpm --filter @agentdeck/mobile export:web
RELAY_DEV=1 RELAY_JWT_SECRET=$(openssl rand -hex 32) node apps/relay/dist/main.node.js &
export AGENTDECK_HOME=/tmp/agentdeck AGENTDECK_DEV_AGENTS=1 AGENTDECK_RELAY_URL=http://127.0.0.1:8787
AGENTDECK_WEB_ROOT=apps/mobile/dist node apps/cli/dist/main.js daemon &
node apps/cli/dist/main.js open                     # desktop web UI
pnpm --filter @agentdeck/mobile web                 # or the app in a browser tab; pair with `agentdeck pair`
```

On a phone: `eas build --profile development` (see `apps/mobile/eas.json`); push needs an EAS
project id in the app config.

## Acceptance criteria that need real devices

These can't run in CI; check them once a staging relay, Expo push credentials and a dev build exist
([`relay-deploy.md`](relay-deploy.md)):

- [ ] Pair a phone on mobile data with a daemon behind home NAT in under 2 minutes.
- [ ] Get a permission push with the app closed, approve it from the lock-screen deep link, see the turn finish.
- [ ] Ship one real change from the phone.

The automated parts (offline replay with no gaps, no plaintext on the relay) are scenarios 10 and 12.
