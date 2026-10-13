# Security policy

Agentdeck runs coding agents on your computers and relays end-to-end encrypted traffic between
your devices. We take reports seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository), or email
**security@agentdeck.dev**. Include what's affected, how to reproduce it, and the impact you
expect. We'll acknowledge within 3 working days and keep you posted until it's fixed; credit is
yours if you want it.

## Supported versions

| Version | Supported |
|---|---|
| latest release (`agentdeck`, `@agentdeck/relay`) | yes |
| older releases | no: upgrade |

## What's in scope

The daemon and CLI, the relay (hosted and self-hosted), the app, and the protocol. The design and
its guarantees (what the relay can and can't see, where secrets live, what devices may do) are in
[`docs/rules/security.md`](docs/rules/security.md) and [`docs/tech-spec.md`](docs/tech-spec.md).
The agents themselves (Claude Code, Codex, Gemini CLI) are their vendors'.
