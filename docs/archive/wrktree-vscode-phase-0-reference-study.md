# Phase 0 — Reference Study

> **Superseded.** This is the original wrktree VS Code extension plan. The project now follows the Agentdeck design in [`../tech-spec.md`](../tech-spec.md); this file is kept for history only.

**Status:** Complete (desk research); one hands-on item open — see §7.
**Date:** August 24, 2026
**Owner:** Sumeet Rohra
**Relates to:** [`wrktree-vscode-prd.md`](./wrktree-vscode-prd.md) §9 (Phase 0), §13 (Immediate next action)

---

## 0. Purpose & method

Phase 0 exists to avoid rebuilding solved problems and to answer the one question that
decides the whole architecture of Phase 2: **do `claude` and `codex` expose structured/JSON
streaming output, or must we scrape ANSI?** This note answers the PRD's three exit-criteria
questions — (a) what we reuse from the reference extension, (b) what VS Code now does natively
that §4 missed, (c) structured output per CLI — then records the decisions those answers
unblock.

**Method & caveats.** Findings come from reading the reference extension's source directly,
capturing `claude --help` on this machine (v2.1.241, `/opt/node22/bin/claude`), and web
research. Two honesty notes:

- **`codex` is not installed here**, so its flags/events are corroborated from OpenAI docs and
  `openai/codex` GitHub issues, not captured `--help`. Confirm byte-exact flags with
  `codex exec --help` before writing the Codex adapter.
- **`code.visualstudio.com` and `github.blog` are egress-blocked** from the research
  environment, so some VS Code version numbers are from search summaries of those pages plus
  secondary coverage. Numbers flagged "~" below are secondary-sourced and want a hands-on
  confirmation (§7).

---

## 1. (a) What we reuse from `tmokmss/vscode-git-worktree-switcher`

The reference is MIT-licensed and its stated design goal is *our exact use case*: switch
worktrees without a window reload "so you don't lose your Claude Code chat panel / terminals /
editor layout." Current `main` is a **full TypeScript rewrite** (esbuild + Vitest), engine
floor **`^1.118.0`**. It's ~850 lines across four `src/` files:

| File | ~LOC | Reusability |
|---|---|---|
| `src/git.ts` | 90 | `execFile` git wrappers + `parsePorcelain`. **Dependency-free — lift directly** (unit-tested). |
| `src/worktrees.ts` | 250 | Pure logic: label / order / dedup / swap-planning. **Dependency-free — lift directly.** |
| `src/focus.ts` | **8** | The atomic swap. **The single most load-bearing technique** — near-verbatim reuse. |
| `src/extension.ts` | 500 | Activation, commands, cache, nested-repo scan, recovery. Adapt the patterns; don't copy wholesale (coupled to its command set + `RepoSnapshot`). |

The four techniques we came to study, confirmed against source:

1. **Porcelain parser** — `git worktree list --porcelain` via `promisify(execFile)` (argument
   array, no shell → injection-safe). Split on blank lines; prefix-match `worktree` / `HEAD` /
   `branch` / `bare` / `detached`; strip `refs/heads/`. Also attaches HEAD committer dates
   (`git show -s --format=%H %ct`) to sort worktrees most-recent-first. Directly reusable, tests
   included.

2. **Multi-repo discovery + dedup** — `git rev-parse --path-format=absolute --git-common-dir`
   is the stable dedup key. `findNestedRepos` walks each workspace folder to depth 2, descending
   concurrently (`Promise.all`), skipping dotfolders and a `SKIP_DIRS` set
   (`node_modules`, `dist`, `build`, `out`, `target`, `vendor`, `tmp`, `coverage`, `.next`,
   `.cache`). First-seen `commonDir` wins in a `Map`. **Submodules are deliberately skipped** via
   `--show-superproject-working-tree`. Labels get a `repo / branch` prefix when >1 repo is in play.

3. **Atomic `updateWorkspaceFolders` swap** — the whole of `focus.ts`:

   ```typescript
   export function focusOn(entries: FolderEntry[]): boolean {
     if (entries.length === 0) return false;
     const folders = vscode.workspace.workspaceFolders ?? [];
     return vscode.workspace.updateWorkspaceFolders(0, folders.length, ...entries);
   }
   ```

   A **single** call — start index `0`, delete count = current folder count, spread the
   replacements — in one transaction. **Never delete-then-add.** The reference asserts the
   "no reload" behavior empirically (in its README, not from VS Code internals): delete-then-add
   churns folder events and reloads the host, whereas a single-transaction replace where a
   surviving folder still occupies slot 0 does not. **We treat this as an observed contract and
   verify it ourselves** in the Phase 1 exit criteria (an open terminal + a running language
   server must survive the switch). Extras worth copying: a cosmetic `collapseExplorer()` after
   the swap, and a `verifyAndRecoverWorkspace` safety net that rebuilds folders from a
   last-known-good snapshot if they vanish.

4. **~60-second discovery cache** — module-level `{ repos, timestamp }`, `CACHE_TTL_MS = 60_000`,
   invalidated by TTL or an explicit `forceRefresh` (the refresh command). **The reference has
   no FileSystemWatcher.** PRD §7.1 / Phase 1 wants a `.git/worktrees/**` watcher, so **we add
   it** rather than assuming the reference does — the TTL cache and the watcher are complementary
   (watcher for prompt invalidation, TTL as a backstop).

**Watch-outs to carry into Phase 1:** the `^1.118.0` engine floor is aggressive (we target
lower — see §6); `--path-format=absolute` needs git ≥ 2.31; submodules are intentionally skipped.

**Sources:** `raw.githubusercontent.com/tmokmss/vscode-git-worktree-switcher/main/src/{git,worktrees,focus,extension}.ts`,
`/package.json`, `/README.md`.

---

## 2. (b) What VS Code now does natively that §4 missed

The category moved since the PRD's §4 was written. Three corrections and one confirmation.

**Native git worktrees since ~v1.103** (not 1.107). Source Control Repositories view → More
Actions → Worktrees → Create / list / remove; both `Git: Open Worktree in Current Window` **and**
`… in New Window` exist as native commands; `git.detectWorktrees` scans pre-existing ones. This
*confirms* PRD §4's "don't build worktree CRUD," and adds a nuance: a native current-window
switch already exists — but it's a **plain folder-reopen / window reload that carries no agent
state**. Our in-place, state-carrying swap is still ours to build.

**⚠️ Agent HQ (v1.107) + Agent Sessions sidebar (~v1.109, Jan 2026) materially erode PRD §2.3.**
VS Code now surfaces **Claude and Codex as selectable *harnesses*** in the Agents window, and can
*discover* Copilot-CLI / Claude-Code / Codex sessions. This is a **curated, first-party set**
(Copilot / Claude / Codex / Cloud) governed by Agent HQ — not an open "register any CLI"
mechanism, and delegation (`/delegate`) plus the session model are Copilot-owned. **The claim
"Agent HQ is never going to run your `claude` CLI" (§2.3) is now false as literally stated.** See
§5 for what this does and doesn't do to the wedge, and the corrected positioning copy.

**Multi-chat per session: base v1.126 (Jun 2026), Claude support v1.128, refined v1.127–1.131
(Jul 2026).** PRD §2.3's "July 2026 multi-chat for Claude" is roughly right, but the base shipped
in June. Still a Copilot/Agent-HQ container, not one our extension can populate.

**⚠️ `TreeItem.badge` does not exist as a finalized API — this contradicts PRD §8.** Only the
view-container-level `TreeView.badge` (`ViewBadge`, numeric) is stable; per-`TreeItem` badges
remain a *proposed* API. **Design consequence:** the per-row agent-state indicator (§7.1) and the
PR badge (§7.3) must be rendered with `TreeItem.iconPath` (codicons, incl. a colored `ThemeIcon`)
plus `description` text — **not** a real per-item badge. The Activity-Bar `waiting-input` badge
(§7.1) *is* doable, via the view-level `ViewBadge`. Phase 1/2 designs must assume this from the
start.

**Confirmed native (keep "wire, don't build"):** `window.createTerminal({ cwd })`, the
`vscode.diff` command, the built-in `vscode.git` API
(`getExtension('vscode.git').exports.getAPI(1)`), and
`authentication.getSession('github', …, { createIfNone: true })` are all available and
long-standing — underwriting §4, §1.5, §3, §7.3.

**Sources:** VS Code release notes v1_107 / v1_126, `docs/sourcecontrol/branches-worktrees`,
`docs/copilot/agents/*`, GitHub Changelog (Jul 2026), Visual Studio Magazine (v1.107),
Tree View API guide, `microsoft/vscode` #161780 / PR #144775 (badge API), API reference.

---

## 3. (c) Structured output per CLI — the gating question

**Verdict: both CLIs expose reliable structured JSON streaming. → Phase 2 is a chat webview,
not an ANSI scraper.** The decisive asymmetry is the *blocked / waiting-for-input* signal.

| | `claude` (Claude Code) | `codex` (OpenAI Codex) |
|---|---|---|
| Structured streaming | **YES** — `--output-format stream-json` (needs `--verbose`; `--include-partial-messages` for token deltas) | **YES** — `codex exec --json` (JSON Lines) |
| Headless entry | `-p` / `--print` | `codex exec "<prompt>"` |
| Programmatic streaming *input* | **YES** — `--input-format stream-json` (persistent stdio session) | No bidirectional stream-json input; drive via stdin / Codex SDK |
| Final-result event | `result` line | `turn.completed` |
| Event shape | `system`/`init`, `assistant`/`user` (Anthropic content blocks), `stream_event` (deltas), `result` | `thread.started`, `turn.started`, `item.started/updated/completed` (`agent_message`, `reasoning`, `command_execution`, `mcp_tool_call`…), `turn.completed` |
| **`waiting-input` / blocked signal** | **YES** — control protocol: emits `sdk_control_request` (`subtype: permission`) and **blocks** for a `control_response`. Machine-detectable, not scraped. Surfaced via the Agent SDK `can_use_tool` callback or the CLI `--permission-prompt-tool`. | **NO** — non-interactive by design; with no TTY, `on-request` downgrades to `never`; denied actions fail as terminal `error` / non-zero-`exit_code` items. No approval event. |

**Consequences for Phase 2:**

- The `waiting-input` state — the PRD's whole differentiator (§3, §7.1, §10) — is **real and
  reliably detectable for `claude`**. That validates the riskiest open item in §10.
- **Recommendation: target the Claude Agent SDK (TypeScript)** rather than shelling out to
  `claude -p` — it gives native message objects, the `can_use_tool` approval callback (our
  blocked-state signal), and `interrupt()`. It's the same control protocol underneath if we later
  choose to spawn the binary directly.
- **Codex is asymmetric**: no mid-stream "approve this?" state. Model it as pre-declared
  sandbox/approval posture (`-a`, `-s`, `--full-auto`) plus terminal failure items. **The
  `CliAdapter` interface (§7.2) must accommodate an adapter that can never emit `waiting-input`.**
- Defensive note: Codex `--json` / `--output-schema` are reported to be silently
  ignored/malformed when MCP servers/tools are active (`openai/codex` #15451) — validate
  defensively.

**Sources:** captured `claude --help` (v2.1.241); code.claude.com `/headless` and
`/agent-sdk/permissions`; `anthropics/claude-code` #24596 (stream-json event reference);
`openai/codex` #24135, #15451, #19816; `developers.openai.com/codex/noninteractive`;
community `codex exec --json` captures.

---

## 4. Decision — Phase 2's shape

**Build the multi-session chat webview (PRD §7.2), not a terminal orchestrator.** Both CLIs
stream structured events, so the webview reads a typed event stream rather than scraping ANSI.
The §10 fallback ("descope the webview, orchestrate in native terminals") is **not needed**.
The agent-state machine (§7.1, `sessionState.ts`) derives from the structured events, with the
Claude/Codex `waiting-input` asymmetry designed in from the start.

---

## 5. Sharp reassessment — does the wedge still hold?

Yes, but narrower and more precisely stated than in the PRD.

**What narrowed.** Agent HQ integrating Claude and Codex as curated harnesses (§2) means the
PRD's sharpest line — "Agent HQ is never going to run your `claude` CLI as a first-class citizen"
(§2.3) — is now wrong as written. Microsoft *does* run `claude` in the Agents window. The
differentiation-narrowing risk the PRD filed under §10 ("Microsoft ships this natively") has
partly materialized.

**What survives — the three confirmed negatives.** Native VS Code still does **not** provide:
(a) an agent-session-state sidebar for CLI agents *outside* the curated harness set; (b)
custom-sidebar-driven **in-place** window switching that carries agent state (the native
current-window switch is a plain reload); (c) **open** orchestration of arbitrary CLIs under
*your own* extension's control and state model. `claude`/`codex` exist in Agent HQ only inside
Copilot's harness model, session model, and delegation — none of which you drive.

**The honest wedge, restated:** wrktree is not "the only way to run `claude` in VS Code" — it's
"**the agent-agnostic console you control**: your own sidebar, your own session-state machine
(including a real `waiting-input` state), your own worktree-per-task switching, over whatever CLI
you already pay for — not a curated harness list governed by someone else's orchestrator." The
`waiting-input`-as-primary-object idea remains genuinely unoccupied in-editor.

**Recommended copy corrections (PRD §2.3, §10, §11 copy discipline):**
- Replace "Agent HQ is never going to run your `claude` CLI" with: "Agent HQ runs `claude` only
  as a curated harness inside Copilot's orchestration and session model — not as a citizen of a
  sidebar and state machine you own and can extend to any CLI."
- Update the §10 risk row "Microsoft ships this natively" from *structural/open* to **partially
  realized**: the mitigation is no longer "they won't," it's "they did, for a curated set — we
  own the open, user-controlled surface and the `waiting-input` primitive."
- Keep leading every README/listing with agent orchestration (§11), and add the explicit "you
  control it, it's not a curated list" contrast, since that is now the live distinction.

---

## 6. Decisions this unblocks (PRD §12 open questions)

Recommendations, for confirmation — not yet committed to code.

- **Which CLIs get first-class adapters at launch?** Build the `CliAdapter` interface for two;
  **ship the Claude implementation first, add Codex immediately after.** Claude is the one that
  owns the `waiting-input` control-protocol signal that *is* the product; Codex proves
  agent-agnosticism but can't demonstrate the headline state. This is exactly the PRD §12
  recommendation, now evidence-backed.
- **VS Code engine floor.** The reference targets `^1.118.0`, but every API we depend on
  (`updateWorkspaceFolders`, `createTreeView`, `ViewBadge`, `createWebviewPanel`,
  `createTerminal({cwd})`, the `vscode.git` API, `authentication.getSession`) predates that.
  **Recommend targeting ~`^1.104.0`** to avoid excluding users, then bumping only if a concrete
  API forces it. Pin the final number in Phase 1 against the APIs actually called.
- **Upstream into the reference, or ship a new extension?** The reuse is real but concentrated in
  ~340 dependency-free lines we can vendor with attribution; the agent console is a much larger,
  differently-shaped surface than a switcher. **Recommend a new extension that borrows those
  files**, but send tmokmss one honest email first (per §12) — cheap, and the answer might change
  the calculus.
- **Adapter shape.** `CliAdapter` must tolerate an implementation that never emits
  `waiting-input` (Codex). Bake that into the Phase 2 `agent/types.ts` from day one rather than
  retrofitting.

---

## 7. Open verification item (hands-on, local)

Everything above about VS Code is documentation-sourced — this headless environment can't run a
GUI VS Code, and some version numbers were egress-blocked. **One hands-on pass is worth doing on
a local machine before Phase 1:** open VS Code ≥1.118, and

1. exercise native Worktrees (Source Control Repositories view) and the current-window switch —
   confirm it *does* reload / drop terminal + LSP state (the thing our atomic swap avoids);
2. open the Agents window and confirm the curated-harness framing in §2/§5;
3. confirm the `TreeItem.badge` gap in §2 against the installed API surface;
4. run `codex exec --help` to byte-confirm the §3 Codex flags.

None of these block writing Phase 1 code, but (1) and (3) directly shape the Phase 1 exit
criteria and the row-rendering approach, so do them early.

---

## 8. Exit criteria — status

| PRD §9 Phase 0 exit criterion | Status |
|---|---|
| (a) What we reuse from the reference | ✅ §1 |
| (b) What VS Code now does natively that §4 missed | ✅ §2 |
| (c) Structured output — yes/no per CLI | ✅ §3 — both YES |
| Gating decision recorded (webview vs terminal) | ✅ §4 — webview |

**Next action:** Phase 1 — Worktree switching MVP (PRD §9), carrying forward the §2 API
corrections (`TreeItem.badge`), the §1 reuse plan (+ the added `.git/worktrees/**` watcher), and
the §6 engine-floor decision.
