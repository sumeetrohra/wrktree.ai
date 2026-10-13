## What and why

<!-- What changes, and why. Link the issue if there is one. -->

## How it was tested

<!-- Unit tests, E2E scenarios, manual steps. -->

## Checklist

- [ ] `pnpm build && pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] End-to-end suites pass for what this touches (`pnpm test:e2e`, `pnpm test:e2e:app`)
- [ ] The protocol only grew (no changed or removed fields)
- [ ] A changeset, if users will notice (`pnpm changeset`)
- [ ] `docs/` updated (and `docs/rules/security.md` if it touches security)
