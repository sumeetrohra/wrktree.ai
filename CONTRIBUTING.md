# Contributing to Agentdeck

Thanks for helping. Agentdeck is MIT-licensed; by contributing you agree your work is too.

## Set up

Node 22.12+, pnpm 10 and git. No accounts or API keys are needed: the relay runs in dev mode and
the tests use a scripted agent (`tools/fake-agent`) and a stand-in GitHub CLI (`tools/fake-gh`).

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e         # the daemon, CLI, relay and phone simulator, end to end
pnpm test:e2e:app     # the app's web build in Chromium
```

The README's "Run it" section runs the whole stack on one machine.

## Before you open a pull request

- Read [`CLAUDE.md`](CLAUDE.md) and [`docs/rules/`](docs/rules/README.md). Most rules are lint
  rules; the rest are reviewed. The ones that matter most: modules never import modules; each
  I/O library is used only in its wrapper; no `any`, `!` or `as`; React has no `useEffect`.
- The protocol (`packages/protocol`) only grows: add fields and commands, never change or remove
  them.
- Every check must pass: build, lint, typecheck, unit tests, `pnpm knip`, and the end-to-end
  suites for what you touched. Don't disable a lint rule to get there.
- User-visible changes get a changeset: `pnpm changeset`.
- Security-relevant changes update [`docs/rules/security.md`](docs/rules/security.md).
- Never commit secrets; `.env` files are git-ignored.

## Reporting bugs

Open an issue with what you did, what happened, and the output of
`agentdeck doctor --bundle doctor.txt` (it removes tokens and email addresses; check before
attaching). Security problems go to [SECURITY.md](SECURITY.md) instead.
