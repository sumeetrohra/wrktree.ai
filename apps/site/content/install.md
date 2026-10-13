# Install

Agentdeck has two parts: the **`agentdeck` CLI**, which runs a small daemon on each computer
where your agents work, and the **app** on your phone (or any browser).

## On each computer

You need **Node.js 22.12 or newer** and **git**, plus the agents you use (Claude Code, Codex,
Gemini CLI) installed the usual way.

```sh
npm install -g agentdeck
agentdeck doctor        # checks everything it needs, with a fix for anything missing
```

### macOS

```sh
brew install node git   # if you don't have them
npm install -g agentdeck
agentdeck install       # start the daemon when you log in (a LaunchAgent)
```

### Linux

```sh
npm install -g agentdeck
agentdeck install       # a systemd user service
```

### Windows

Install Node.js and Git for Windows, then in PowerShell:

```powershell
npm install -g agentdeck
agentdeck install       # a scheduled task at logon
git config --global core.longpaths true
```

Worktrees go under `%LOCALAPPDATA%\agentdeck\wt` on Windows so paths stay short.

`agentdeck uninstall` stops starting the daemon at login; your chats and settings stay.

### Without Node.js: one file

Each release also has `agentdeck` as a single program (Node and the native parts inside): download
it from the release page, or

```sh
brew install agentdeck/tap/agentdeck          # macOS
sudo apt install ./agentdeck_<version>_amd64.deb    # Debian, Ubuntu
sudo dnf install ./agentdeck-<version>-1.x86_64.rpm # Fedora, RHEL
winget install Agentdeck.Agentdeck            # Windows
```

The first run unpacks itself into your cache folder; then it works like the npm version.

## On your phone

Install **Agentdeck** from the App Store or Google Play, or open the web app in any browser.
Then follow the [quick start](/quickstart/).
