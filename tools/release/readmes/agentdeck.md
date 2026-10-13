# agentdeck

Drive coding agents (Claude Code, Codex, Gemini CLI) running on your computers from your phone or
browser. The agent runs on your machine, in a git worktree, with your own logins; your phone talks
to it end to end encrypted through a relay.

```sh
npm install -g agentdeck
agentdeck login            # sign this computer in (email link)
agentdeck install          # start the daemon when you log in
agentdeck profile add claude --name Work
agentdeck repo add ~/src/my-app
```

Then open the app on your phone and sign in with the same email.

- `agentdeck status`: what's running, each profile's usage.
- `agentdeck doctor`: what's missing on this computer, and how to fix it.
- `agentdeck open`: the same app in your desktop browser.

Needs Node.js 22.12+ and git. Docs, the app and the source:
https://github.com/sumeetrohra/wrktree.ai. MIT licensed.
