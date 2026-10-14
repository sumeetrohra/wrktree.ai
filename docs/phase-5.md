# Phase 5: After launch

Goal (from [`tech-spec.md`](tech-spec.md)): what makes the phone a full workstation for agents,
in order of value to users. Decision: no team plan, SSO or audit log for now.

| Milestone | What | Status |
|---|---|---|
| **5a** | Terminal tab | **built** (phones need a native build to try it) |
| **5b** | Parallel compare: one task, several agents, side by side | **built** |
| **5c** | Voice dictation in the composer | **built** (needs a native build to try) |
| **5d** | Video attachments (key frames to the agent) | **built** |
| **5e** | End-to-end encrypted preview | **built** (phones need a native build to try it) |
| **5f** | Single-binary daemon and installers | **built** (publishing the tap, winget and the release is the owner's) |

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

- **Windows:** the tests and E2E 30 run `cmd.exe` there (`AGENTDECK_SHELL`): PowerShell's line
  editor, driven by scripted input through ConPTY on a CI runner, never acts on Enter. The
  terminal still starts PowerShell for people; `AGENTDECK_SHELL` picks another shell.

Pending: trying the WebView terminal on real phones (native build), and PowerShell by hand on
Windows.

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

## 5d: video attachments

- **App:** a video button in the composer (phones and the web build). Videos up to 50 MB (the
  computer's upload cap), read with `expo-file-system` on phones (L20). Through the relay, uploads
  are paced at three 256 KB parts a second, inside the relay's per-phone budget (2 MB/s), which
  otherwise closes the connection; a 50 MB clip takes about a minute.
- **Computer:** `infra/media` runs `ffmpeg` (one frame a second, at most 1280 px wide, up to five
  minutes) and keeps eight frames spread evenly over the clip, first and last included. The agent
  gets them as JPEG images after a line saying they are a video's frames, in order; attachments
  now come before the message text. Without ffmpeg, or with a file it can't read, the agent gets
  a note instead and the chat shows a warning. `agentdeck doctor` checks for ffmpeg;
  `AGENTDECK_FFMPEG` points at another one.
- **Tests:** frame picking against a fake ffmpeg (unit); paced uploads (unit); E2E 34 (a clip
  becomes three frames; a broken file is explained); app E2E 35 (the composer's video button,
  uploaded through the relay, frames reach the agent). The E2E suites use
  `e2e/fixtures/fake-ffmpeg.cjs`.

## 5e: end-to-end encrypted preview

- **Phones:** *Start preview* asks for a `sealed` preview: no relay URL, but a random token for this
  device. The app starts a server on `127.0.0.1` (a free port; `lib/localserver`, L30) and the
  WebView loads from it. Each request becomes `preview.fetch` and each WebSocket (hot reload)
  `preview.wsOpen/wsSend/wsClose`, all sealed end to end like chats; the dev server's socket
  messages come back as `preview.ws` events on `preview:<wsId>`. The relay only carries
  ciphertext. The app picks the socket id and subscribes before opening it, since those events
  are live only (`EventBus.emit`: never written to disk).
- **Computer:** the same proxy as the relay tunnel (`PreviewProxy`: only an open preview's port, on
  loopback), with the same 25 MB and 60 s limits. A sealed token works only for the client that
  started the preview and dies with it (SEC26).
- **The web build** keeps the relay tunnel (TLS only, SEC23): a browser can't listen on a port.
- **Android** blocks plain HTTP; `localhost-cleartext.plugin.js` allows it for `127.0.0.1` only
  (checked with `expo prebuild`). iOS allows loopback addresses already.
- **Tests:** the local HTTP/WebSocket codec and the bridge against fakes (unit); the WebSocket
  handshake against RFC 6455's sample (crypto); `EventBus.emit` (unit); E2E 36 from phone-sim (page
  and hot-reload socket through sealed commands, the page never on the wire in the clear, the
  token useless to a second phone, to another client and after stopping). Maestro flows for a native build:
  `e2e/maestro/sealed-preview.yaml` and `terminal.yaml`.

Pending: running those Maestro flows on simulators (native builds).

## 5f: single-file agentdeck and installers

- **The file:** `pnpm release sea` makes `release/bin/agentdeck(.exe)` for the OS and CPU it runs
  on: Node's single executable application with a launcher as its main script and one asset, the
  built npm package with its dependencies installed for that platform (native modules included),
  pruned of sources and other platforms' prebuilt addons, packed and gzipped (about 9 MB on top of
  Node). The first run unpacks it into the user's cache (`~/.cache/agentdeck`,
  `~/Library/Caches/agentdeck`, `%LOCALAPPDATA%\agentdeck\cache`, once per build) and loads the CLI
  from there with `createRequire`, the way a single executable reaches files on disk; Node 22.12+
  loads the ES module bundle synchronously. macOS gets an ad-hoc signature (distribution signing is
  the publisher's). `agentdeck install` writes services that run the file itself.
- **Checked on every push:** CI builds it on Linux, macOS and Windows and runs it: `--version`,
  `--help`, the daemon starts (SQLite loads from inside it), `status`, and `doctor` sees node-pty.
- **Installers:** `pnpm release installers <archives>` writes a Homebrew formula (Apple silicon,
  and Intel when built; with a `brew services` definition), winget manifests (a portable exe in a
  zip), a `.deb` (`dpkg-deb`) and an `.rpm` (`rpmbuild`), with each archive's SHA-256. The
  `Binaries` workflow builds all three OSes on a version tag (or by hand) and drafts a GitHub
  release with the archives and packages; publishing it, the tap and the winget PR is the owner's.
- **Tests:** the launcher unpacks once and runs an ES module CLI with its dependencies; pruning keeps
  only this platform's addon; the formula, manifests, control file and spec (unit). The .deb was
  installed and run by hand here.

Pending (the owner's): a Homebrew tap repository, a winget-pkgs pull request, signing (Apple
Developer ID and notarization, Windows Authenticode), and Linux arm64 and Intel Mac runners if
wanted.

## Fixes after 5f

- **A phone added while the computer runs** was refused on its first try when it knocked within
  2 seconds of the computer's last device-list refresh: the on-demand refresh was skipped instead
  of delayed. It now waits out the window and refreshes (`Remote.refresh`), so the handshake goes
  through; E2E 36 signs in a second phone mid-scenario.
