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
| **4e** | Open source files, npm packages, docker-compose | planned |
| **4f** | Store-ready app, Sentry | planned |
| **4g** | Landing page and docs site | planned |

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
