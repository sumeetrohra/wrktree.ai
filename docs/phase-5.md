# Phase 5: After launch

Goal (from [`tech-spec.md`](tech-spec.md)): what makes the phone a full workstation for agents,
in order of value to users. Decision: no team plan, SSO or audit log for now.

| Milestone | What | Status |
|---|---|---|
| **5a** | Terminal tab | **built** (phones need a native build to try it) |
| **5b** | Parallel compare: one task, several agents, side by side | planned |
| **5c** | Voice dictation in the composer | planned |
| **5d** | Video attachments (key frames to the agent) | planned |
| **5e** | End-to-end encrypted preview | planned |
| **5f** | Single-binary daemon and installers | planned |

## 5a: terminal

- **Protocol (additive):** `term.list` (with `enabled`: may this device use terminals here?),
  `term.open {worktreeId, cols, rows}`, `term.input`, `term.resize`, `term.close`, `term.output`
  (the scrollback as a blob, like `proc.output`); events `term.output` and `term.status` on the new
  `term:<id>` topic, sealed end to end like every other event.
- **Daemon:** `modules/terminals` runs the user's shell (`$SHELL`, else bash or sh; PowerShell on
  Windows) on a pseudo-terminal in the worktree through `infra/pty`, the only place node-pty is
  imported (L27). node-pty is an optional dependency, loaded on first use: where it didn't
  install, everything else works and `agentdeck doctor` says why. Output is coalesced (30 ms),
  the newest 256 KB stays readable, at most four shells per worktree, closed after 30 minutes
  without typing and with the worktree or the daemon. Terminal events never go to the cloud.
- **Who may use it (SEC25):** a shell runs anything, without approvals, so other devices get one
  only after `agentdeck config terminal remote on` on that computer (`off` again applies at once).
- **App:** a Terminal tab with xterm.js: in the page on the web build, in a WebView on phones
  (the same pinned version from a CDN, checked by subresource integrity; L28). A key bar adds
  Esc, Tab, Ctrl-C, Ctrl-D and the arrows. Keystrokes go in order with one `term.input` in
  flight, so typing fast or pasting stays inside the relay's per-device frame budget.
- **Tests:** the pty wrapper and the terminals service (output, resize, scrollback, idle close,
  the cap) on all three OSes; E2E 30 from phone-sim (refused, allowed, `echo`, `git status`,
  resize, close, refused again); app E2E 31 (typing in xterm.js, Ctrl-C from the key bar, close).

Pending: trying the WebView terminal on real phones (native build).
