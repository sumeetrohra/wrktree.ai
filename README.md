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

You sign in on your phone or browser; each computer joins your account once with `agentdeck login`.
Every device on the account sees every computer's work, and talks to it end-to-end encrypted (X25519 +
XChaCha20-Poly1305, per-connection ephemeral keys). Multiple agent accounts are first-class
"profiles" (isolated `CLAUDE_CONFIG_DIR` / `CODEX_HOME`), with hand-off to another profile
when one hits its usage limit.

## Status

**Phases 1 and 2 are built, and Phase 3a and 3b.** The daemon runs agents in worktrees; phones and browsers sign in and
drive any number of linked computers through the relay, end to end encrypted, from the app (tested as its web build in
Chromium; native builds need an EAS project). The daemon also serves the app as a desktop web UI.
Every chat is kept in Firebase, so it stays readable when its computer is off. From the phone you
can review an agent's changes, read the code, ask about specific lines, run the repo's scripts and
ship the work as a pull request the agent drafted.
20 end-to-end scenarios plus unit, contract and lint-rule tests pass on every push; see
[`docs/phase-1.md`](docs/phase-1.md), [`docs/phase-2.md`](docs/phase-2.md) and [`docs/phase-3.md`](docs/phase-3.md).

| Phase | What | State |
|---|---|---|
| 0 | Spikes: kill the three biggest unknowns | partly done, see [`docs/spikes.md`](docs/spikes.md) |
| 1 | Daemon core, usable from a local CLI client | ✅ built |
| 2 | Relay, crypto, mobile MVP — the phone becomes the daily driver | ✅ built (real-device acceptance pending EAS) |
| 3 | Cloud history (3a); review, code, ship (3b); preview (3c) — judge an agent's work without a laptop | 3a, 3b ✅ built (real Firebase, real `gh` pending); 3c next |
| 4 | Multi-account power features and public launch | |
| 5 | After launch: teams, parallel compare, voice, E2E preview, terminal | |

Each phase has a task checklist and acceptance criteria in the spec, written so it can be
handed to a coding agent as a standalone unit.

## Run it

Needs Node 22.12+, pnpm 10 and git. Everything below runs locally with **no accounts and no API
keys**: the relay runs in dev mode and mints its own sign-in tokens. Agents use their own logins
(each profile runs the agent's normal login), so there are no Anthropic, OpenAI or Google keys to
set here.

### The whole stack on one machine

```sh
cp .env.example .env                              # relay + daemon/CLI settings
cp apps/mobile/.env.example apps/mobile/.env      # app settings
pnpm install
pnpm build

pnpm relay                                        # 1. the relay, dev mode, on :8787
pnpm agentdeck daemon                             # 2. the daemon (another terminal)
pnpm agentdeck repo add ~/src/my-repo             # 3. a repo and an agent profile
pnpm agentdeck profile add claude --name Personal  # or codex, gemini; `fake` needs no account
pnpm --filter @agentdeck/mobile web               # 4. the app in a browser (Expo, :8081)
```

5. In the app: **Dev sign-in** with any user id (say `me`).
6. On the computer: `pnpm agentdeck login --dev me`, the same user. Every device signs in, the
   computer included; it shows up under **Work**. (With Firebase: `pnpm agentdeck login`, enter
   your email, paste the link from the email.)
7. Start a task with **New task**: pick the computer, repo, profile and, optionally, a model.

More ways in:

- **A second computer on the same machine:** another terminal with its own home and name, then
  `login` again:
  `AGENTDECK_HOME=/tmp/agentdeck-desktop AGENTDECK_HOST_NAME=desktop pnpm agentdeck daemon`
  (and the same variables in front of `pnpm agentdeck login --dev me`).
- **The desktop web UI:** `pnpm --filter @agentdeck/mobile export:web`, set `AGENTDECK_WEB_ROOT` to
  `apps/mobile/dist`, restart the daemon, and run `pnpm agentdeck open`. It talks to this computer
  directly; signing in there adds your other computers.
- **A phone:** Expo Go or a development build (`eas build --profile development`). Set
  `EXPO_PUBLIC_RELAY_URL` and the relay's `HOST=0.0.0.0` so the phone can reach your computer's
  LAN address.
- **Local only, no relay:** leave `AGENTDECK_RELAY_URL` unset and drive the daemon from the CLI:
  `pnpm agentdeck dev watch`, `pnpm agentdeck dev send repo.list`.

### Production

1. **Firebase:** create a project and enable **Authentication → Email link (passwordless)**; add
   your web app's domain to the authorized domains.
2. **Relay:** deploy to Cloudflare or self-host it with Docker, with `RELAY_DEV` unset and
   `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` and `FIREBASE_STORAGE_BUCKET` set
   ([`docs/relay-deploy.md`](docs/relay-deploy.md)). Deploy `firebase/firestore.rules` and
   `firebase/storage.rules` to the project.
3. **App:** build with `EXPO_PUBLIC_RELAY_URL` and `EXPO_PUBLIC_APP_URL`; everything else comes
   from the relay.
4. **Each computer:** `agentdeck relay set https://relay.example.com`, `agentdeck login` (sign
   in with your email), and `agentdeck install` to start the daemon when you log in.

### Configuration

Two example files hold every setting with its default: [`.env.example`](.env.example) (relay,
daemon and CLI; loaded by `pnpm relay` and `pnpm agentdeck`) and
[`apps/mobile/.env.example`](apps/mobile/.env.example) (the app; Expo inlines it at build time).

| Key | Read by | Needed | Where it comes from |
|---|---|---|---|
| `FIREBASE_PROJECT_ID` | relay | **production** | Firebase console → Project settings |
| `FIREBASE_API_KEY`, `FIREBASE_STORAGE_BUCKET` | relay (handed to devices) | **production** | Firebase console → Project settings → Web API key; Storage bucket |
| `EXPO_PUBLIC_RELAY_URL` | app | **production** (local default works) | your relay's URL |
| `EXPO_PUBLIC_APP_URL` | app | production | where the web app is hosted (email links come back to it) |
| `RELAY_PUBLIC_URL` | relay | production | the relay's own public URL |
| `AGENTDECK_RELAY_URL` | daemon | to use a relay | your relay's URL (or `agentdeck relay set`) |
| `AGENTDECK_APP_URL` | daemon | optional | the web app's URL, where `agentdeck login` email links come back |
| `EXPO_ACCESS_TOKEN` | relay | optional | expo.dev access token, if push security is on |
| `RELAY_DEV`, `RELAY_DEV_SECRET` | relay | **local dev only** | `1` and any 32+ characters; enables Dev sign-in |
| `FIREBASE_*_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST` | relay (dev) | optional | the Firebase Emulator Suite (`pnpm emulators`) |
| `PORT`, `HOST`, `RELAY_DATA_DIR` | relay (self-host) | optional | defaults `8787`, `127.0.0.1`, `~/.agentdeck-relay` |
| `AGENTDECK_HOME`, `AGENTDECK_HOST_NAME` | daemon | optional | data folder; this computer's name |
| `AGENTDECK_BROWSE_ROOTS`, `AGENTDECK_WEB_ROOT`, `AGENTDECK_KEYSTORE`, `AGENTDECK_PORT_RANGE`, `AGENTDECK_LOCAL_PORT`, `AGENTDECK_DEV_AGENTS`, `AGENTDECK_DEV_ORIGINS`, `AGENTDECK_LOG_STDERR` | daemon | optional | see `.env.example` |

No secret ever goes into the app: the Firebase Web API key is public by design, and the relay
holds no sign-in secrets of its own. Security rules in `firebase/` keep each account's data to
its own signed-in user. Real `.env` files are git-ignored.

## Develop

```sh
pnpm test          # unit tests
pnpm test:e2e      # end-to-end: real relay, daemons, CLI and a scripted ACP agent
pnpm test:e2e:app  # the app's web build in Chromium (needs a Playwright Chromium)
pnpm e2e:record    # both, rendered to artifacts/e2e.mp4 and app-e2e.mp4 (needs ffmpeg)
pnpm lint && pnpm typecheck   # strict lint (structure, naming, library wrappers) and tsc
pnpm knip          # no unused files, exports or dependencies
```

The coding rules every change follows live in [`docs/rules/`](docs/rules/README.md) and are
summarised for agents in [`CLAUDE.md`](CLAUDE.md). A pre-commit hook (husky + lint-staged) runs
lint, Prettier and the typecheck; CI adds knip, `pnpm audit` and CodeQL.

## Docs

- [`docs/rules/`](docs/rules/README.md) — typing, naming, structure, library-call, React,
  data, security and testing rules, each tagged with what enforces it
- [`docs/phase-1.md`](docs/phase-1.md) — what Phase 1 built, its E2E suite and the video
- [`docs/phase-2.md`](docs/phase-2.md) — Phase 2: relay and crypto (2a), the app (2b), sign-in with
  many computers and devices (2c)
- [`docs/phase-3.md`](docs/phase-3.md) — Phase 3: cloud chat history in Firebase (3a); review,
  code and preview (3b, 3c)
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
