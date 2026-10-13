# Phase 4: Accounts power and launch

Goal (from [`tech-spec.md`](tech-spec.md)): several accounts of one agent, used to their limits,
and a public launch. Decisions: MIT everywhere, no billing or plan limits, store-ready config
(submissions are the owner's), a landing page and docs site, npm publishing.

| Milestone | What | Status |
|---|---|---|
| **4a** | Usage and limits per profile | **built** |
| **4b** | Hand-off to another profile or agent | **built** |
| **4c** | Shared config (MCP, skills, instructions) | **built** |
| **4d** | Windows hardening, keep-awake, `uninstall`/`status`/`doctor` | **built** |
| **4e** | Open source files, npm packages, docker-compose | **built** (publishing needs the npm token) |
| **4f** | Store-ready app, Sentry | **built** (submission is the owner's) |
| **4g** | Landing page and docs site | **built** (the domain and Cloudflare token are the owner's) |

## 4a: usage and limits per profile

### Detecting a limit

Each agent reports limits in its own words, as an adapter error or (Claude Code) as its reply.
`modules/agents/limit-text.utils.ts` reads both, with the reset time when the text gives one:

| Shape | Example | Reset |
|---|---|---|
| epoch after a bar | `Claude AI usage limit reached\|1760400000` | that time |
| clock time | `5-hour limit reached ∙ resets 3pm`, `Try again at 11:45 PM` | the next such time here |
| duration | `try again in 2 hours 13 minutes`, `Please retry in 12.5s` | now + duration |
| Google API | `"retryDelay": "37s"` | now + delay |
| ISO time | `resets at 2026-10-13T18:00:00Z` | that time |

A reply only counts as a limit when it is short (≤ 500 characters) and reads like a limit notice,
so an answer *about* rate limiting doesn't stop the chat.

### Counting

`modules/usage` keeps `usage_samples` (migration 5 adds per-chat running totals):

- Every completed turn records its tokens: ACP reports a session's running totals in the prompt
  response (`usage`, where the adapter sends it); the growth since the last turn is this turn's.
- A limit records the time and reset; it lasts until the reset time, or until a turn on that
  profile completes. Without a reset time the chat retries its queue after 15 minutes.
- Each change publishes `usage.updated` with the profile's snapshot; `profile.usage {profileId}`
  returns it: `limitHit`, `resetAt`, `limitedAt`, and today's `inputTokens`/`outputTokens`.

### Chats at a limit

A limited chat **queues** messages instead of refusing them; the queue goes out when the limit
resets. Every `chat.status` `limited` event carries `resetAt`.

### In the app

- The chat shows a banner while its profile is limited, with when it resets.
- Settings lists each online computer's profiles: available or at its limit (resets in …), and
  today's tokens.

### Tests

| # | Scenario | Checks |
|---|---|---|
| 4 | Chat lifecycle (extended) | a send while limited is queued and goes out at the reset; `profile.usage` shows the limit lifted and today's tokens |
| 23 | Usage limits from the phone | today's tokens per profile; a limit the agent states in its reply, with its reset time; a message queued while limited goes out at the reset; the limit lifts |
| 24 (app) | The app: a profile at its usage limit | the banner with "resets in …"; a message typed meanwhile shows as queued and goes out at the reset; Settings shows the profile at its limit, then available with today's tokens |

Unit tests cover the reset-time shapes above, the reply heuristic and the counting rules.
Pending: samples from real Claude Code, Codex and Gemini limits (the shapes above are from their
documented messages).

## 4b: hand-off to another profile or agent

`chat.handoff {chatId, profileId, agent?, model?}` continues a chat in the **same worktree** on
another profile (and so possibly another agent), or the same profile with another model. It
returns the new chat, whose `handedOffFrom` names the old one (migration 6).

The new chat's first message is a **brief built without a model call** (the old agent is usually
the one at its limit), from `app/handoff.utils.ts`:

- who it takes over from and why (limit, or the user moved it), and the task title;
- the conversation so far (last 40 messages, each clipped at 2,000 characters);
- the agent's last plan;
- the worktree's changes against its base (up to 50 files, untracked ones included);
- approvals it was waiting on;
- what the user wants next: their last message if the agent never answered it, else "continue".

Messages the user had queued on the old chat move to the new one, after the brief and in order;
the old chat gets a note saying where the work went, the new one where it came from. Handing off
to the same profile and model is refused.

In the app, the limit banner offers **Continue on another profile**, and every chat has
**Continue on…** in its header: pick a profile, and the new chat opens.

| # | Scenario | Checks |
|---|---|---|
| 25 | Hand a limited chat to another profile | on Work the agent writes NOTES.md, then hits its limit with a message queued; hand-off to Personal: same worktree, `handedOffFrom`, the title; the brief names Work and the limit, quotes the conversation and lists NOTES.md; the queued message follows as its own turn (not in the brief); the old chat says where the work went; the same profile is refused |
| 26 (app) | The app: continue a limited chat on another profile | the limit banner → Continue on another profile → Personal; the new chat opens, notes where it came from, and its agent gets the brief |

The fake agent only reads a `#script:` token from the last paragraph of a prompt's last text
block, so a brief (or a resume seed) quoting earlier scripted prompts doesn't rerun them.

## 4c: shared config (instructions, MCP servers, skills)

Everything every profile on a computer shares lives in the daemon's `shared/` folder:

| In `shared/` | In each profile folder | How the agent gets it |
|---|---|---|
| `instructions.md` | `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex), `GEMINI.md` (Gemini CLI) | linked; the agent reads its own file |
| `skills/` | `skills/` (Claude Code) | linked folder |
| `mcp.json` | — | passed as `mcpServers` with every ACP `session/new` and `session/load` |
| anything else | the same name | linked as is |

- **Linking** runs at profile creation, on every daemon start, and after each change. On
  Windows folders are junctions and files are copies (refreshed on each sync).
- **Overrides:** a profile folder's own file wins: a real file where the link would go (or a copy
  someone changed) is left alone and listed by `profile.overrides`. `agentdeck-mcp.json` in a
  profile folder adds or replaces MCP servers by name for that profile.
- **Protocol:** `config.shared.get`, `config.shared.set {instructions?, mcpServers?}`,
  `profile.overrides`, `profile.removeOverride`.
- **Who may change what (SEC24):** instructions can be edited from any device; MCP servers start
  programs on the computer, so changing them, and dropping an override, is local only.

```sh
agentdeck config shared                                   # show
agentdeck config shared instructions ./team-rules.md
agentdeck config shared mcp add github -- npx -y @modelcontextprotocol/server-github
agentdeck config shared mcp add docs --url https://mcp.example.com/
agentdeck config overrides <profileId> [remove CLAUDE.md]
```

In the app, **Settings → Shared with every profile** edits the instructions and lists the MCP
servers and skills.

| # | Scenario | Checks |
|---|---|---|
| 27 | Shared instructions and MCP servers | `config shared mcp add` from the CLI; the phone sees it but can't change MCP servers; instructions set from the phone land as the agent's own file; the agent reads them and its session lists the MCP server; a profile's own file survives a shared edit and is listed; only the computer can drop it, after which the shared file applies |
| 28 (app) | The app: instructions every profile shares | Settings lists the MCP server added on the computer; saving instructions there reaches the next turn |

## 4d: Windows, keep-awake, and looking after the computer

### Windows

- **Short worktree paths:** new worktrees go under `%LOCALAPPDATA%\agentdeck\wt\<repo>-<id>\<branch>`
  instead of next to the repo, so deep `node_modules` paths stay under 260 characters.
  `AGENTDECK_WORKTREE_ROOT` moves them anywhere, on any OS.
- **Long paths in git:** `git worktree add` runs with `core.longpaths=true` on Windows;
  `agentdeck doctor` suggests turning it on globally.
- **Process trees:** scripts and agents are stopped with `taskkill /T /F`, which takes the whole
  tree. Job objects would need a native helper; they are not used.
- **Service:** `agentdeck install` registers a logon task (`schtasks`), `agentdeck uninstall`
  deletes it. CI checks both plans on Windows (`--dry-run`); a real create and delete is manual.

### Keep-awake

While any chat is running or waiting for approval, the daemon holds a sleep lock, and lets go
when none is: `caffeinate -i -w <daemon pid>` on macOS, `systemd-inhibit --what=idle:sleep` on
Linux, PowerShell calling `SetThreadExecutionState` on Windows. The display may still sleep. A
missing helper is logged once and ignored. Off with `"keepAwake": false` in the daemon's
`config.json` or `AGENTDECK_KEEP_AWAKE=0`.

### New commands

| Command | What it does |
|---|---|
| `agentdeck uninstall [--dry-run]` | undoes `install` (launchd, systemd or the logon task); chats and settings stay |
| `agentdeck status` | the daemon, account and relay, repos/worktrees/chats (working, limited), and each profile's limit state and tokens today |
| `agentdeck doctor [--bundle <file>]` | Node.js, git (and long paths on Windows), `gh` and its sign-in, the adapters (`npx`), Gemini CLI, the daemon, the relay, the worktree ports; each problem with its fix. `--bundle` writes the checks and the daemon's recent logs with tokens, keys and emails removed |

| # | Scenario | Checks |
|---|---|---|
| 29 | Status, doctor, install and uninstall | `status` shows the daemon, one repo/worktree/chat and the profile's tokens; `doctor` passes and its bundle has the logs without the planted email, token and bearer value; `install`/`uninstall --dry-run` print this OS's service plan |

Unit tests cover the uninstall plans, every doctor check against a fake machine, redaction, the
keep-awake helpers and the worktree paths. E2E runs put worktrees under the test folder
(`AGENTDECK_WORKTREE_ROOT`), so every OS exercises the short-root layout.

## 4e: open source, npm, self-host

- **Repo files:** MIT [`LICENSE`](../LICENSE), [`CONTRIBUTING.md`](../CONTRIBUTING.md),
  [`SECURITY.md`](../SECURITY.md) (private reporting, supported versions),
  [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), issue forms and a pull request template.
- **npm packages,** built by [`tools/release`](../tools/release) from the workspace:

  | Package | What | How |
  |---|---|---|
  | `agentdeck` | the CLI and daemon (`bin: agentdeck`), with the app's web build for `agentdeck open` | one esbuild bundle of the `@agentdeck/*` code; npm dependencies (better-sqlite3, ripgrep, ws, …) stay dependencies |
  | `@agentdeck/relay` | the self-host relay (`bin: agentdeck-relay`) | bundled the same way |
  | `@agentdeck/protocol` | the schemas and types | published as built |

  Every package: `license: MIT`, `repository`, `engines: node >=22.12`, provenance.
  The workspace packages themselves stay private.
- **Versions:** [Changesets](../.changeset/README.md). The CLI, daemon, relay and protocol share
  one version. On `main`, the release workflow opens a "Version packages" pull request; merging it
  publishes the new versions (`pnpm release publish`, skipping versions npm already has). It needs
  an `NPM_TOKEN` repository secret.
- **CI smoke test** on Linux, macOS and Windows: `pnpm release smoke` packs the three packages,
  installs the tarballs into an empty project, runs `agentdeck --help`, starts the installed
  daemon and asks `agentdeck status` (native modules load), parses the relay bundle and imports
  the protocol.
- **Self-host with Docker Compose:** [`docker-compose.yml`](../docker-compose.yml) builds the relay
  image and keeps its data in a volume; see [`relay-deploy.md`](relay-deploy.md).

Pending (the owner's): the `NPM_TOKEN` secret, then merging the first "Version packages" PR.

## 4f: store-ready app

- **Identity:** `dev.agentdeck.app` on both stores; icon, Android adaptive icon, splash and web
  favicon in `apps/mobile/assets/`, rendered from one SVG by `pnpm --filter @agentdeck/e2e
  store:assets`.
- **Permissions, with the reason shown to the user:** camera and photos (attach an image to a
  message), notifications. Microphone and location are blocked on Android.
- **EAS:** `eas.json` builds `production` against the hosted relay and app URLs, and has `submit`
  profiles: iOS (App Store Connect API key via `EXPO_ASC_*`, or interactive), Android (a Play
  service account key at `apps/mobile/store/google-service-account.json`, git-ignored; internal
  track, draft).
- **Listing:** `apps/mobile/store/metadata.json` (name, subtitle, description, keywords, URLs,
  categories), `data-safety.md` (App Privacy and Play Data safety answers, export compliance),
  `review-notes.md` (how a reviewer gets a working account).
- **Screenshots:** `pnpm --filter @agentdeck/e2e store:screenshots` drives the real web build
  against a real daemon and relay at App Store 6.9", iPad 13" and Play phone sizes into
  `apps/mobile/store/screenshots/`: Work, an approval, a finished chat, a diff, Settings. The
  scripted agent stands in for Claude Code there (`AGENTDECK_DEV_AGENT_ID`, dev mode only) and
  runs a showcase script per profile.
- **Privacy and terms:** [`privacy.md`](privacy.md) and [`terms.md`](terms.md) (also on the site).
- **Crash reporting:** Sentry through `modules/sentry` (L8), only when the build sets
  `EXPO_PUBLIC_SENTRY_DSN`: no personal data, no tracing, no screenshots; breadcrumbs keep their
  kind but never their text or data, and events lose the user, request and extras (SEC8,
  unit-tested).
- **CI** checks that the Expo config resolves with every plugin and asset.

Pending (the owner's): Apple and Google developer accounts, `eas init` (project id), `eas build
--profile production`, filling in App Store Connect / Play Console from `store/`, and
`eas submit`. A Sentry project's DSN as an EAS secret, if wanted.

## 4g: landing page and docs site

- **`apps/site`** is a small static generator (TypeScript plus `marked`, no framework): a
  landing page, install per OS, quick start, and docs rendered from this repo's Markdown, so
  there is one source: the [user guide](guide.md), [self-hosting the relay](relay-deploy.md),
  the [security model](rules/security.md), [privacy](privacy.md) and [terms](terms.md).
- **Links:** relative links between rendered docs become site links; links to anything else in
  the repo point at GitHub. The build fails on any internal link that doesn't resolve to a
  built page or file (unit-tested, and run in CI as its own step).
- **Look:** one stylesheet, light and dark from the system setting, readable at phone width
  with no sideways scrolling; the app icon is reused.
- **Deploy:** `pnpm --filter @agentdeck/site run deploy` (Wrangler, Cloudflare Pages project
  `agentdeck-site`). The `Site` workflow builds and deploys on pushes to `main` that touch the
  site or docs, once the repository has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  secrets; until then it skips.

Pending (the owner's): the Cloudflare secrets, and pointing the domain at the Pages project.
