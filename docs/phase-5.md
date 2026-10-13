# Phase 5: After launch

Goal (from [`tech-spec.md`](tech-spec.md)): what makes the phone a full workstation for agents,
in order of value to users. Decision: no team plan, SSO or audit log for now.

| Milestone | What | Status |
|---|---|---|
| **5a** | Terminal tab | **built** (phones need a native build to try it) |
| **5b** | Parallel compare: one task, several agents, side by side | **built** |
| **5c** | Voice dictation in the composer | **built** (needs a native build to try) |
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

## 5b: parallel compare

- **Protocol (additive):** `compare.start {repoId, baseRef?, branch, title, prompt, targets}` with
  2–4 targets (profile, agent, optional model), `compare.list`, `compare.get`, `compare.pick`, and
  the `compare.updated` event on `repo:<id>`.
- **Daemon:** `modules/compare` keeps the record (migration 7). The app layer creates one
  worktree per target from the same base (`<branch>-1`, `<branch>-2`, …; if one can't be
  created, the ones already made are deleted again), and starts each chat with the prompt as soon
  as its worktree is ready, from the bus, so the phone can go offline right after starting.
  An entry whose setup fails, or whose chat can't start, records why. Picking one archives the
  others (restorable like any archived worktree).
- **App:** New task has *One agent* and *Compare agents*. The compare page shows a card per
  attempt (who, chat status, changed files with line counts, refreshed every few seconds) with
  *Open chat*, *Changes* and *Keep this one*; the repo page lists its compares.
- **Tests:** the record (unit); E2E 32 from phone-sim (two profiles, both answer in their own
  worktree, keep one, the other archived; wrong agent and existing branches refused with nothing
  left behind); app E2E 33 (start from New task, cards, a changed file, keep one).

## 5c: voice dictation

- **App:** a microphone button in the composer. What is said goes into the text box (after what
  was typed), utterance by utterance, so it can be edited before sending; nothing is sent
  automatically.
- **Privacy:** `lib/speech` wraps `expo-speech-recognition` (L29) and only offers dictation where
  speech is recognized on the device (`requiresOnDeviceRecognition`): no audio leaves the phone.
  The web build has no microphone button, because browsers send audio to their vendor's service.
  The app now asks for the microphone and speech recognition (iOS strings in `app.json`;
  `RECORD_AUDIO` is no longer blocked on Android); privacy policy and data-safety answers say so.
- **Tests:** the recognizer mocked (on-device only, partial and final text, errors, permission
  refused) and how utterances join the typed text.

Pending: trying it on real phones (native build).
