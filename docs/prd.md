# PRD: wrktree

**Author:** Sumeet Rohra
**Status:** Final — v3
**Date:** August 24, 2026
**Repo:** https://github.com/sumeetrohra/wrktree.ai
**Extension ID:** `sumeetrohra.wrktree`
**Supersedes:** Worktree Conductor v1 (Aug 12), Perch v2 (Aug 24)

---

## 0. One-liner

**Conductor, but it lives in VS Code and it drives the agent CLI you already use.**

A VS Code sidebar where each row is a task being worked on by an agent, backed by a git worktree, showing live agent state. Click a row and the whole window re-points at that worktree — no reload, no new window, no app switching. Agent-agnostic: it orchestrates `claude`, `codex`, and whatever comes next, rather than shipping an agent of its own.

---

## 1. Problem

Running four coding agents in parallel today means four isolated contexts, and every existing solution asks you to leave your editor to manage them — or locks you into one vendor's agent.

The mechanics are settled. Git worktrees are the isolation primitive, one worktree per agent per task. That is no longer contested; by Q1 2026 essentially every major AI coding tool shipped worktree support. What remains unsolved for a developer who lives in VS Code and drives Claude Code or Codex from the CLI:

- **The orchestrators are outside the editor.** Conductor, Superset, Nimbalyst, and Pane are separate desktop apps. Switching to a worktree means switching applications — losing editor context, language server, open tabs, muscle memory.
- **The in-editor options are vendor-locked.** VS Code's Agent HQ orchestrates Copilot and Copilot-framework custom agents. It is genuinely good. It is also never going to run your `claude` CLI as a first-class citizen.
- **Claude Code's own VS Code extension has no worktree support.** Open feature request `anthropics/claude-code#69554` asks for `--worktree` parity with the CLI so multiple agents can work the same codebase without conflicts. It isn't there.
- **The existing worktree extensions are git tools, not agent tools.** Seven-plus of them list worktrees and switch between them. None know whether an agent is running in one, blocked waiting for input, or finished twenty minutes ago.

**Goal:** the missing layer — agent-session state as the primary object in a VS Code sidebar, worktrees as the substrate, in-place window switching as the mechanic.

---

## 2. Competitive analysis

### 2.1 Category map

Four camps exist. We are entering a fifth that is currently thin.

| Camp | What it is | Examples |
|---|---|---|
| **A. Desktop orchestrators** | Standalone app; worktree-per-agent; you leave the editor | Conductor, Superset, Nimbalyst (ex-Crystal), Pane, Emdash, Mux, super.engineering |
| **B. Terminal orchestrators** | TUI/tmux session managers | Claude Squad, ccmanager, dmux, agentree |
| **C. Task boards** | Kanban over agent runs | Vibe Kanban, Agent Kanban |
| **D. First-party IDE agents** | The IDE vendor's own agent, with worktrees bolted on | VS Code Agent HQ + Copilot, Cursor, Windsurf, Kilo Code, Pochi |
| **E. In-editor, agent-agnostic orchestration** | A thin VS Code layer over whatever CLI agent you already use | **← thin. wrktree's target.** |

### 2.2 Direct competitors — VS Code extensions

These matter most; they occupy the exact surface we build on.

| Extension | What it does | Overlap | Assessment |
|---|---|---|---|
| **`tmokmss.vscode-git-worktree-switcher`** (~170 installs, MIT, v0.4.1) | In-place worktree focus/unfocus via `updateWorkspaceFolders`, no window reload. Multi-repo discovery 2 levels deep, dedup by `git common-dir`, 60s cache. Command-palette driven. Explicitly "designed for use with Claude Code." | **This is our entire Phase 1.** | Read it, don't rebuild it. MIT. It validates the core mechanic and resolves our biggest technical risk. Its gap: no sidebar TreeView, no agent state, no chat, no PR. A git utility, not an agent console. |
| `jackiotyu.git-worktree-manager` | Multi-workspace switching, shared git commit info, run code across directories. Mature, actively maintained, bilingual. | Phase 1 + parts of 1.5 | Most feature-complete pure worktree manager. Opens worktrees in a **new window** by default — the exact thing we exist to avoid. |
| `BrettMiller99/VSCode-WorkTreeSwitcher` | Activity Bar view, status bar integration, bulk ops, rich tooltips | Phase 1 + Phase 4 | Closest to our *shape* (sidebar + status bar), still purely git-state. Zero agent awareness. |
| `8ctavio.workforest`, `alexiszamanidis/vscode-git-worktrees`, `chrisdicarlo.vscode-switch-git-worktree`, `CodeInKlingon.git-worktree-menu` | Variations on list / create / remove / switch | Phase 1 | Long tail. Confirms the switcher niche is saturated and commoditized. |

**Conclusion: the worktree-switcher category is crowded and commoditized.** Shipping "another worktree switcher" in 2026 earns a few hundred installs and no attention. This single finding drives §3.

### 2.3 Direct competitors — in-editor agent orchestration

| Product | Model | Strengths | Gap we exploit |
|---|---|---|---|
| **VS Code Agent HQ** (native, v1.107+) | Copilot + custom agents; background agents in isolated workspaces; delegation local → background → cloud; agents run in dedicated git worktrees. July 2026 added multi-chat for Claude: one agent session holds several chats, each with its own history, title, and model. | First-party, deeply integrated, free with Copilot, ships monthly | **Locked to the Copilot agent framework.** If your workflow is `claude` in a terminal with your own CLAUDE.md, hooks, MCP servers, and subscription, Agent HQ doesn't orchestrate that. |
| **Pochi** | Worktree-per-agent as VS Code tabs; each tab = code + chat + history + tooling; diff vs main; create PR; per-worktree integrated terminal | The closest in-editor analogue. Same architectural insight we had. | It's a **full agent product** — you adopt Pochi's agent. We want to be a thin layer over the agent you already pay for. |
| **Kilo Code** | Parallel agents on git worktrees; VS Code + JetBrains + CLI; MIT; MCP marketplace | Multi-IDE, open source, large distribution | Same vendor-lock shape: it's Kilo's agent. |
| **Cline** | Plan-and-act, 5M+ installs, MCP-native | Largest OSS agent install base | No worktree orchestration layer at all. |
| **Claude Code VS Code extension** | Chat panel; sessions operate on the current branch | Official, huge user base | **No worktree support.** Issue #69554 is a queue of users describing wrktree to Anthropic. Our clearest evidence of unmet demand. |

### 2.4 Adjacent competitors — desktop orchestrators

| Product | Platform | License | Notes |
|---|---|---|---|
| **Conductor** (Melty Labs) | macOS, Apple Silicon only | Free, BYO provider | The design benchmark. Claude Code, Codex, Cursor, OpenCode. Genuinely good diff review flow. Limits: Mac-only, single-project, no roles, no mobile. |
| **Superset** | Mac-focused | Source-available | Native Rust, terminal-centric, local + remote. Runs a heavy comparison-SEO operation at `superset.sh/compare` — study as GTM, not just product. |
| **Nimbalyst** (formerly Crystal, by Stravu) | Electron, cross-platform | — | Worktree-per-session plus visual editing. Only tool in the category with a native iPhone app for reviewing/resuming sessions. |
| **Pane** | Cross-platform incl. Windows | AGPL-3.0 | Any CLI agent, because each agent gets a real terminal. Philosophically closest to wrktree — agent-agnostic — but as a desktop app. |
| **Claude Squad** | Terminal (tmux TUI) | Open source | Leanest option; the power-user default. |
| **Vibe Kanban** (BloopAI) | npx, local | Apache-2.0 | Bloop announced shutdown April 10, 2026 — subscriptions refunded, cloud features removed, now fully local and community-maintained. **A cautionary data point on monetizing this category.** |
| **Emdash** | Cross-platform | YC W26 | PM-tool integrations as the differentiator. |
| **Sculptor** | — | — | Containers instead of worktrees. Stronger isolation, heavier. |

### 2.5 Honest read

**Against us:**

- The switcher niche is saturated; one extension already ships our Phase 1 exit criteria.
- Microsoft is actively building in this room, monthly, free with a subscription our users already have.
- Desktop orchestrators are polished, free, and a year ahead.
- The category has a demonstrated monetization problem. This should be an MIT personal/OSS tool, not a startup.

**For us:**

- **Nobody occupies camp E.** Agent-agnostic orchestration *inside* VS Code is genuinely thin. Pochi is closest, and it wants you to use its agent.
- **Claude Code's own extension has the gap, publicly** (#69554).
- **"Don't leave the editor" is a real, felt constraint.** Every camp-A tool asks you to alt-tab.
- **Agent state as the primary object is unoccupied in-editor.** No VS Code worktree extension shows "agent is blocked waiting for your input on `feat/auth`."
- **Commoditized switching is good news.** Phase 1 is a week on top of a proven MIT reference. The real product starts at Phase 2.

---

## 3. The wedge

**wrktree is not a worktree manager with agent features. It is an agent console that happens to use worktrees.**

Three commitments follow:

**1. The sidebar row is an agent session, not a worktree.**
A row's primary label is the task. Its primary state is agent state: `idle`, `running`, `waiting-input`, `done`, `failed`. Git state (dirty, ahead/behind) is *secondary decoration*, not the point. This one visual decision separates wrktree from all seven existing worktree extensions.

**2. Agent-agnostic, adapter-based, no proprietary agent.**
We never ship an agent. We drive `claude`, `codex`, and successors through a thin adapter interface. The user's existing subscription, config, MCP servers, and hooks keep working. This is the defensible position against Agent HQ, Pochi, and Kilo — none can adopt it without cannibalizing their own agent.

**3. Never leave the window.**
No new VS Code windows, no external app, no reload. The sidebar plus native VS Code surfaces, nothing else.

**Anti-positioning:** not a kanban board, not a cloud service, not a team tool, not multiplayer, not an agent, not a Conductor clone.

---

## 4. What we don't build

| Capability | Where it already exists | Our job |
|---|---|---|
| Diff viewer | Native diff editor (`vscode.diff`), Source Control view, GitLens | Invoke it, point it at the right worktree. No custom diff UI. |
| Terminal panel | Integrated Terminal | `createTerminal({ cwd })`. One line. |
| Changed-files list | Source Control view, per open folder | Free once the workspace root switches correctly. |
| Git state (branch, ahead/behind, dirty) | Built-in `vscode.git` extension API | *Read* it to decorate rows. Never re-render, never re-poll. |
| **Worktree creation/removal** | **Now native**: Source Control Repositories view → More Actions → Worktrees → Create Worktree | Offer a convenience command that pre-fills a naming convention; delegate otherwise. No worktree-management UI. |
| **Background agents in worktrees** | **Now native** (Agent HQ v1.107) — for Copilot-framework agents | Don't compete on Copilot orchestration. Orchestrate *other* CLIs. |
| **Multi-chat per session** | **Now native in Copilot** (July 2026) | Don't build this for Copilot. Build it for `claude`/`codex`, which lack it in-editor. |
| Command palette, keyboard nav | Native | Register commands into it. |
| In-place workspace swap | Proven by `tmokmss.vscode-git-worktree-switcher` (MIT) | Read the implementation. Don't rediscover the technique. |
| PR review UI | GitHub Pull Requests extension | See Phase 3 — now leaning strongly toward *wire*, not *build*. |

**What's genuinely left:**

1. An agent-session-aware sidebar where rows carry live agent state and click switches the window in place.
2. A multi-session chat panel for non-Copilot CLI agents, persisted per worktree.
3. Thin PR scoping — probably wiring into the GitHub PR extension.

---

## 5. Non-goals

- Cloud/remote sandboxes, multiplayer, mobile. Local-only.
- Building our own coding agent.
- Non-worktree workflows (multiple full clones).
- Custom diff UI, terminal UI, file explorer, or worktree-CRUD UI.
- Monetization. Ship MIT. See the Vibe Kanban data point in §2.4.
- Windows/Linux parity isn't a goal but is a likely free side effect — worth not actively breaking, since it's a real differentiator against Conductor and Superset.

---

## 6. Core concept

A **wrktree** view in the VS Code sidebar. Each row is one task — an agent working in a git worktree. Clicking a row re-points the entire window at that worktree.

**Switch modes** (configurable):

- **Mode A (default): focus.** Replace the workspace folder set with just the selected worktree via `vscode.workspace.updateWorkspaceFolders()`. Same window, same extension host, no reload. Search, Quick Open, and Explorer scope naturally.
- **Mode B: show all.** All worktrees as folders in one multi-root workspace. No switching, noisier scope.

**Critical implementation note** (from the reference implementation): the swap must be a *single* `updateWorkspaceFolders` call that never leaves the workspace momentarily empty. Delete-then-add is what triggers the reload. Atomic replace does not.

---

## 7. Feature breakdown

### 7.1 Agent-session sidebar (TreeView) — the core gap

- Discovers worktrees via `git worktree list --porcelain`, refreshed on `.git/worktrees/**` events.
- **Row anatomy, in priority order:**
  1. Task title (from the agent session; falls back to branch name)
  2. **Agent state icon** — idle / running (spinner) / waiting-input / done / failed
  3. Branch name
  4. Git decorations: dirty dot, ahead/behind
  5. PR badge if one exists
- Row actions: **Focus**, **New chat**, **Open terminal here**, **Open PR**, **Remove worktree**, **Rename task**.
- **`waiting-input` needs a notification path.** The value of parallel agents evaporates if you don't notice one is blocked. Activity Bar badge + optional native notification.
- Multi-repo discovery, 2 levels deep, deduplicated by `git common-dir`.

### 7.2 Multi-chat panel (Webview) — the core gap

- Tabbed chat per worktree, multiple concurrent sessions.
- Each chat backed by a spawned CLI process in that worktree's cwd.
- **Prefer structured/JSON streaming output over ANSI scraping.** Resolve before writing any UI — see Phase 0.
- Persist transcripts to `.vscode/wrktree/<worktree-hash>/chats/*.json`.
- Background-task indicator: timer + running command.
- Not a terminal replacement.

### 7.3 PR scoping — deliberately thin

The GitHub Pull Requests extension exists and Agent HQ is expanding. **Default is wire-not-build.** Minimum viable: a PR status badge on the row, plus a command that opens the existing GitHub PR extension scoped to the active worktree's branch.

### 7.4 Cross-cutting

- Command palette parity for everything.
- Status bar: current worktree + agent state.
- Settings: switch mode, agent CLI paths, PR poll interval, base branch, notification preferences.

---

## 8. Architecture

```
wrktree/
├── src/
│   ├── extension.ts              # activation, command registration
│   ├── worktree/
│   │   ├── types.ts
│   │   ├── discovery.ts          # porcelain parsing, multi-repo, fs watcher
│   │   ├── treeProvider.ts       # TreeDataProvider — agent state first
│   │   ├── switcher.ts           # atomic updateWorkspaceFolders
│   │   └── gitApi.ts             # vscode.git decorations
│   ├── agent/
│   │   ├── types.ts
│   │   ├── cliAdapter.ts         # interface + one impl per CLI
│   │   ├── processManager.ts     # spawn/track per session
│   │   ├── sessionState.ts       # THE differentiator: agent state machine
│   │   └── chatWebview.ts
│   ├── pr/
│   │   └── prLink.ts             # thin — badge + delegate to GitHub PR ext
│   ├── storage/
│   │   └── chatPersistence.ts
│   └── statusBar.ts
└── package.json
```

No `diff/`, `terminal/`, or worktree-CRUD modules — all native.

**Key VS Code APIs:** `workspace.updateWorkspaceFolders`, `window.createTreeView`, `window.createWebviewPanel`, `window.createTerminal`, the built-in `vscode.git` API, `authentication.getSession('github', …)`, `TreeItem.badge` / `window.withProgress` for agent state.

---

## 9. Phased implementation

Each phase is self-contained for agent handoff: incoming state, what to build, exact files and interfaces, exit criteria. Phases are strictly additive — later phases extend the module boundaries in §8, they don't restructure earlier ones.

**Phase 1 is table stakes, not the value proposition. Phase 2 is where wrktree actually starts.** Reach it in week two, not month two.

---

### Phase 0 — Reference study (half a day, do not skip)

**Goal:** avoid rebuilding solved problems.

- Read `tmokmss/vscode-git-worktree-switcher` (MIT) end to end. Specifically: the porcelain parser, multi-repo dedup by `git common-dir`, the atomic `updateWorkspaceFolders` swap, and the 60-second discovery cache.
- Install VS Code ≥1.107. Exercise native Worktrees in the Source Control Repositories view, plus Agent HQ, to confirm §4 is still accurate at build time.
- Confirm whether `claude` and `codex` expose structured/JSON streaming output. **This one answer gates all of Phase 2's design.**

**Exit criteria:** a one-page note answering (a) what we reuse from the reference, (b) what VS Code now does natively that §4 missed, (c) structured output — yes or no, per CLI.

---

### Phase 1 — Worktree switching MVP

**Incoming state:** empty repo. Establishes the extension skeleton.

**Goal:** sidebar lists worktrees; click re-points the window in place, no reload.

**Build:**

```
wrktree/
├── package.json                  # activationEvents, contributes.views, contributes.commands
├── src/
│   ├── extension.ts
│   ├── worktree/
│   │   ├── types.ts
│   │   ├── discovery.ts
│   │   ├── treeProvider.ts
│   │   └── switcher.ts
│   └── util/
│       └── git.ts
```

**`worktree/types.ts`:**
```typescript
export interface Worktree {
  id: string;              // absolute path — stable identity
  path: string;
  branch: string;
  repoName: string;        // for multi-repo label prefixing
  isMain: boolean;
  isDirty?: boolean;       // stub false; populated Phase 1.5
  aheadBehind?: { ahead: number; behind: number }; // stub
  agentState?: AgentState; // stub 'none'; populated Phase 2
}
```

**`worktree/discovery.ts`:**
- Walk up via `git rev-parse --show-toplevel`, then run `git worktree list --porcelain`.
- Parse porcelain blocks (blank-line separated; fields `worktree`, `HEAD`, `branch`, `bare`, `detached`).
- **Multi-repo:** scan up to 2 levels deep for sibling repos; dedup by `git rev-parse --git-common-dir`; prefix labels `repo / branch` when >1 repo is in play.
- Cache ~60s; invalidate on workspace-folder change; pre-warm on activation.
- `FileSystemWatcher` on `.git/worktrees/**`.
- Export `discoverWorktrees(): Promise<Worktree[]>`.

**`worktree/treeProvider.ts`:**
- `WrktreeProvider implements vscode.TreeDataProvider<Worktree>`.
- Label = branch (or `repo / branch`), description = path, `contextValue = 'worktree'` for `when` clauses.
- `_onDidChangeTreeData` fires on watcher events and explicit refresh.

**`worktree/switcher.ts`:**
- `focus(worktree)`: single atomic `updateWorkspaceFolders(0, currentCount, { uri })`. **Never delete-then-add.**
- `showAll(worktrees)`: replace with all worktree folders.
- Collapse the explorer after a switch for a clean tree.
- Mode from `workspace.getConfiguration('wrktree').get('switchMode')`.

**Commands:** `wrktree.focus`, `wrktree.showAll`, `wrktree.newWorktree`, `wrktree.removeWorktree`, `wrktree.openTerminalHere`, `wrktree.refresh`.

**Exit criteria:**
- A repo with 2+ worktrees lists them all.
- Clicking switches in <1s **with no window reload** — verify by confirming an open terminal session and a running language server survive the switch.
- A multi-repo folder shows correctly prefixed labels.
- No `diff/`, `terminal/`, or worktree-CRUD directories exist.

---

### Phase 1.5 — Git state enrichment

**Incoming state:** Phase 1 complete; `isDirty` / `aheadBehind` stubbed.

**Build:** `worktree/gitApi.ts` — acquire via `vscode.extensions.getExtension('vscode.git')!.exports.getAPI(1)`; expose `getRepoState(path): { dirty, ahead, behind }` by matching the `Repository` in `gitApi.repositories`; subscribe to `repository.state.onDidChange` for live refresh.

**Exit criteria:** rows show real dirty dots and ahead/behind counts, updating live as you commit and push, without polling `git status` ourselves.

---

### Phase 2 — Agent sessions (the actual product)

**Incoming state:** Phases 1–1.5 complete. Does not modify `worktree/` except to read `agentState`.

**Goal:** per-worktree, multi-session chat backed by a spawned CLI, with agent state surfaced on the sidebar row.

**Build:**

```
├── src/
│   ├── agent/
│   │   ├── types.ts
│   │   ├── cliAdapter.ts
│   │   ├── processManager.ts
│   │   ├── sessionState.ts
│   │   ├── chatWebview.ts
│   │   └── media/
│   └── storage/
│       └── chatPersistence.ts
```

**`agent/types.ts`:**
```typescript
export type AgentKind = 'claude-code' | 'codex';

export type AgentState =
  | 'none'            // no session in this worktree
  | 'idle'            // session open, nothing running
  | 'running'         // agent is working
  | 'waiting-input'   // BLOCKED ON THE HUMAN — the state that matters
  | 'done'
  | 'failed';

export interface ChatMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  isBackgroundTask?: boolean;
}

export interface ChatSession {
  id: string;
  worktreeId: string;      // Worktree.id from Phase 1
  agentKind: AgentKind;
  title: string;           // derived from first message, editable
  messages: ChatMessage[];
  state: AgentState;
  lastCommand?: string;
  startedAt?: number;
}
```

**`agent/cliAdapter.ts`:**
```typescript
interface CliAdapter {
  start(cwd: string): void;
  send(message: string): void;
  onMessage(cb: (msg: ChatMessage) => void): void;
  onStateChange(cb: (s: AgentState) => void): void;
  stop(): void;
}
```
One adapter per CLI. Implementation path decided by Phase 0's structured-output finding: parse structured events (preferred) or scrape ANSI output via `Pseudoterminal` (fallback, fragile).

**`agent/sessionState.ts`** — the differentiator. Derives `AgentState` per session and aggregates to a per-worktree state for the tree row. Emits an event the tree provider subscribes to. **Detecting `waiting-input` reliably is the hardest and most valuable part of this phase.** Budget accordingly; prototype it before building the webview.

**`agent/processManager.ts`** — `Map<sessionId, { adapter, session }>`; `createSession(worktree, agentKind)`, `sendMessage(sessionId, text)`, `stopSession(sessionId)`; emits message and state-change events.

**`agent/chatWebview.ts`** — `ChatPanel` per worktree, tabs = sessions for that worktree. Typed `WebviewMessage` union shared in `agent/types.ts`, over `postMessage` / `onDidReceiveMessage`. Renders background-task timer + last known command.

**`storage/chatPersistence.ts`** — `save(session)`, `loadAll(worktreeId)`; writes `.vscode/wrktree/<worktreeId-hash>/chats/<sessionId>.json`; debounced on append, flushed on panel dispose.

**Notification path:** when any worktree enters `waiting-input`, badge the Activity Bar icon; optional native notification behind a setting.

**New commands:** `wrktree.newChat`.

**Exit criteria:**
- "New chat" from a row opens a working conversation against a real CLI process in that worktree's cwd.
- Multiple sessions per worktree run concurrently without cross-talk.
- **The sidebar row visibly changes state as the agent works**, including a distinct `waiting-input` state that badges the Activity Bar.
- Chat history survives a VS Code restart.
- A long-running shell command shows a background-task timer.

---

### Phase 3 — PR wiring

**Incoming state:** Phases 1–2 complete. Reads `Worktree.branch`; doesn't modify `worktree/` or `agent/`.

**Before building:** spike the GitHub Pull Requests extension's exposed API. **Default assumption is wire, not build.** Only build a custom timeline webview if the spike shows the native extension can't be scoped per-branch cheaply — and write down why.

**Wire path (preferred):**
- `pr/prLink.ts`: resolve `owner/repo` from `git remote get-url origin`; auth via `vscode.authentication.getSession('github', ['repo'], { createIfNone: true })`; fetch minimal PR status for the *active* worktree's branch only.
- Render a badge on the tree row. `wrktree.openPr` delegates to the GitHub PR extension or `vscode.env.openExternal`.
- Poll only the active worktree, default 45s, configurable.

**Build path (fallback only):** `pr/types.ts`, `githubClient.ts` (Octokit), `prCache.ts`, `prWebview.ts` — single timeline combining status, checks, comments, and commits; merge button that reads the repo's actual configured merge method rather than hardcoding squash.

**Exit criteria:** the active worktree's PR status appears on its row within one poll interval; API usage bounded to the active worktree only; no custom PR UI unless the spike justified it in writing.

---

### Phase 4 — Polish & cross-cutting

**Incoming state:** Phases 1–3 complete and independently working. Touches all modules lightly, adds no new domain logic.

- `src/statusBar.ts`: current worktree name + agent state, sourced from `gitApi.ts` (1.5) and `sessionState.ts` (2).
- `contributes.configuration`: `switchMode`, `agentCliPaths`, `prPollIntervalSeconds`, `defaultBaseBranch`, `notifyOnWaitingInput`.
- Command palette parity: every context-menu action from Phases 1–3 registered as a top-level command with a clear title (`wrktree: New Chat`, etc.).
- Shared status-icon component reused across tree rows, chat tabs, and status bar.

**Exit criteria:** every mouse action has a palette equivalent; settings cover every configurable behavior from Phases 1–3; no new files beyond `statusBar.ts` and config wiring.

---

## 10. Risks

| Risk | Status | Mitigation |
|---|---|---|
| **`updateWorkspaceFolders` causes an extension-host reload** | **RESOLVED** — the reference implementation demonstrates in-place swapping without reload | Swap atomically in one call; never leave the workspace empty. Verify in Phase 1 exit criteria via terminal/LSP survival. |
| **CLI stdout scraping is fragile** | **OPEN — highest technical risk** | Resolve in Phase 0. If neither CLI offers structured streaming, seriously consider descoping the chat webview and instead orchestrating agents in native terminals with state inferred from process/exit signals. |
| **Detecting `waiting-input` reliably** | **OPEN — new, and it is the product** | Prototype early in Phase 2. Without it, wrktree is just an eighth worktree switcher. |
| **Microsoft ships this natively** | **OPEN — structural** | Cannot be mitigated, only positioned around. Agent-agnosticism is the moat: Agent HQ orchestrating `claude` well would cannibalize Copilot. |
| **Anthropic ships worktree support in the Claude Code extension** (#69554) | **OPEN — likely** | If it ships, differentiation narrows to multi-agent (Claude + Codex side by side) and the unified sidebar. Track that issue actively. |
| **Category has no proven monetization** | Accepted | Ship MIT as a personal/OSS tool. Don't plan a business around it. |
| **Crowded switcher niche means launch gets ignored** | **OPEN — the GTM risk** | Do not launch at Phase 1. Launch at Phase 2 with the agent-state sidebar as the demo: four rows, three spinners, one "waiting for you" badge. |
| **The name anchors to the commoditized category** | **OPEN — accepted trade** | See §11. Mitigate in copy, not in the name: never describe wrktree as a "worktree manager." Lead every README, listing, and post with agent orchestration. |

---

## 11. Naming

**Final: wrktree.** Domain `wrktree.ai`, repo `github.com/sumeetrohra/wrktree.ai`, extension ID `sumeetrohra.wrktree`.

**Verified clean (Aug 24, 2026):**

| Check | Result |
|---|---|
| npm `wrktree` | **Free.** `wrktree-ai` also free. |
| GitHub | **3 results total.** `wrkspace-co/Wrktree` (dormant linktree clone, 0 stars) and `Sathya4683/wrktreez` (0 stars, different spelling). No meaningful conflict. |
| VS Code Marketplace | No `wrktree` extension. |
| Trademark exposure | None found. |
| Claude-phonetic risk | None. |

**Trade-off, stated honestly.** The name is descriptive and anchors to *worktrees* — the commoditized layer — while §3 positions wrktree as an *agent console*. That's a real tension. Two upsides that outweigh it: the namespace is genuinely clean (rare in 2026), and the name is instantly legible to exactly the developer who has the problem. The mitigation is copy discipline: the README, marketplace listing, and every launch post lead with agent orchestration, not worktree management. "wrktree runs your coding agents in parallel, inside VS Code" — never "wrktree manages your git worktrees."

**Eliminated by research:** Grove (OpenAI Grove founder program), Trellis (active agentic state engine on npm, Aug 2026), Gibbon (GibbonEdu, active OSS platform), Perch (`unordinarytech/perch`, an active macOS AI-dev assistant; both `perch.dev` and `perch.sh` unavailable), Conductor and all variants (Melty Labs, Code Conductor, Microsoft Conductor).

**Hard constraint for any future rename:** nothing phonetically near "Claude." Anthropic holds 27+ Claude trademarks and forced the Clawdbot → Moltbot → OpenClaw rename in January 2026 — a week of chaos, typosquat domains, a fake token, and a harassed maintainer. A forced rename mid-launch is the most expensive thing that can happen to a project like this.

---

## 12. Open questions

- **Which agent CLIs get first-class adapters at launch?** Claude Code only, or Claude Code + Codex? Two adapters proves agent-agnosticism, which is the entire positioning — but doubles Phase 0 and Phase 2 risk. Recommendation: build the adapter *interface* for two, ship the *implementation* for one, and add the second immediately after launch as proof.
- **Do we contribute upstream instead?** `tmokmss/vscode-git-worktree-switcher` is MIT and explicitly targets Claude Code users. Adding an agent-state sidebar to an extension with an existing user base may beat launching an eighth switcher from zero. Worth one honest email before Phase 1.
- **Does Mode A resetting open editor tabs matter enough to build per-worktree tab-state memory?** The reference implementation doesn't, and doesn't appear to have suffered for it.
- **Delegate worktree creation entirely to VS Code's native Worktrees UI**, or keep a convenience command for the `repo-taskname` naming convention?
- **Marketplace publish or personal tool?** Affects settings UX polish and how much the GTM risk in §10 actually matters.

---

## 13. Immediate next action

Phase 0. Half a day. Three questions answered in writing:

1. What do we reuse from `tmokmss/vscode-git-worktree-switcher`?
2. What does VS Code ≥1.107 now do natively that §4 hasn't captured?
3. Do `claude` and `codex` expose structured/JSON streaming output?

Question 3 is the one that matters. It determines whether Phase 2 is a chat webview or a terminal orchestrator, and that is the whole product.
