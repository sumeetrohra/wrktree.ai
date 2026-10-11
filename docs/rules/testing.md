# Testing

| Id | Rule | Enforced by |
|---|---|---|
| T1 | Unit tests sit next to the file they test (`foo.service.ts` → `foo.service.test.ts`) and run with Vitest (Node packages) or jest-expo (app). | `review` |
| T2 | Every acceptance criterion in the tech spec has an E2E scenario in `e2e/src/scenarios/` that drives the real daemon and CLI. | `review` |
| T3 | Every security rule marked `test` in [security.md](security.md) has a test that fails if the protection is removed. | `review` |
| T4 | Every lint-enforced rule has a fixture in `tools/lint-fixtures/` that must produce that rule's error, so a config change can't silently turn a rule off. | `test` |
| T5 | Tests never hit real agents or spend tokens; they use `tools/fake-agent`. Real agents only run in the nightly smoke job. | `review` |
| T6 | No test is skipped, disabled or quarantined to get CI green; fix the cause. | `review` |
| T7 | Test files may use non-null assertions and unchecked casts on fixture data; nothing else relaxes. | `lint` (test override) |
