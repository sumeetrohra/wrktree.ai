# Guide

## Computers, profiles and worktrees

- A **computer** runs the `agentdeck` daemon. Sign it in with `agentdeck login`; it joins your
  account and the app finds it. `agentdeck status` shows what it's doing.
- A **profile** is one account of one agent (Claude Code, Codex or Gemini CLI), with its own
  config folder and login: `agentdeck profile add <agent> --name <name>`.
- Every task runs in its own **worktree**: a branch of the repo checked out in its own folder,
  so agents never step on each other or on your own checkout.

## Chats

- Messages sent while the agent is busy (or at its limit) **queue** and go out in order.
- **Approvals:** "Allow once", "Always" (for this kind of action in this chat), "Deny", or
  deny with a message telling the agent what to do instead.
- **Attachments:** images (screenshots) go to the agent with your message.
- **Ask about lines:** in a diff or file, tap a line (long-press for a range), then "Ask the
  agent about this".

## Compare agents

**New task → Compare agents** gives one task to two to four profiles at once (say Claude Code
and Codex, or two models). Each works in its own worktree from the same base; the compare page
shows them side by side with what each changed. Open a chat or its Changes to judge, then **Keep
this one**: the others are archived.

## Review and ship

A worktree has tabs: **Chats, Changes, Files, Logs, Terminal, Preview, Ship**.

- **Changes:** what changed since the base branch, file by file.
- **Files:** browse, filter by name, or search contents.
- **Logs:** the repo's named scripts (`.agentdeck/config.json` → `scripts`), with live output.
- **Terminal:** a shell in the worktree, on its computer, with a row of keys phones lack (Esc,
  Tab, Ctrl-C, arrows). It runs anything you type there, with no approvals, so from your other
  devices it's off until you run `agentdeck config terminal remote on` on that computer. It
  closes after 30 minutes without typing.
- **Preview:** the app the worktree is building, opened through the relay
  (`preview: {"script": "dev"}` in the repo config turns it on).
- **Ship:** commit, push, and create, then squash and merge, a pull request through your own
  `gh`. "Draft with the agent" writes the title and description.

## Dictation

On a phone, tap the microphone in the composer and speak: the words appear in the text box (after
anything you typed) for you to edit and send. Speech is recognized on the phone; it's only
offered where the phone can do that.

## Usage and limits

**Settings** shows each profile's state: available, or at its limit and when it resets, plus
today's tokens. A chat at its limit shows a banner: wait for the reset (queued messages go out
then), or **Continue on another profile**: a new chat in the same worktree picks up from a
summary of this one, without spending the limited account's quota.

## Shared config

Instructions, MCP servers and skills shared by every profile on a computer:

```sh
agentdeck config shared instructions ./team-rules.md
agentdeck config shared mcp add github -- npx -y @modelcontextprotocol/server-github
agentdeck config shared
```

Each agent reads the instructions as its own file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`). A
profile can keep its own file instead. Instructions can be edited in the app's Settings; MCP
servers only change on the computer.

## Command line

| Command | What it does |
|---|---|
| `agentdeck login` / `logout` | join or leave your account |
| `agentdeck install` / `uninstall` | start the daemon at login, or stop |
| `agentdeck status` | what's running, each profile's usage |
| `agentdeck doctor [--bundle file]` | check this computer; bundle redacted logs for a bug report |
| `agentdeck profile add <agent> --name <n>` | add an agent account |
| `agentdeck repo add <path>` | add a repository |
| `agentdeck config shared …` | shared instructions, MCP servers, skills |
| `agentdeck config terminal remote on\|off` | allow terminals from your other devices |
| `agentdeck open` | the app in your desktop browser |
| `agentdeck hosts` / `devices` | your computers; your phones and browsers |
