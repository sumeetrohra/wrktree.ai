# Engineering rules

These rules keep Agentdeck's code consistent no matter who (or what) writes it. They are
modelled on [create-vibe-react](https://www.npmjs.com/package/create-vibe-react) and extended
for the daemon, the CLI and a React Native app.

Every rule has an id and says what enforces it:

| Tag | Meaning |
|---|---|
| `lint:<rule>` | ESLint fails the build (`pnpm lint`, `--max-warnings 0`) |
| `tsc` | The type checker fails the build |
| `test` | A unit, E2E or lint-fixture test fails |
| `CI` | A CI job fails (audit, knip, CodeQL) |
| `review` | Not mechanically checkable; reviewers and agents must apply it |

An exception to a lint-enforced rule needs an inline
`// eslint-disable-next-line <rule> -- reason: <why>` comment. A disable without a reason fails lint
(`lint:eslint-comments/require-description`).

| File | Covers |
|---|---|
| [golden-rules.md](golden-rules.md) | The non-negotiables |
| [typing.md](typing.md) | TypeScript strictness, runtime validation |
| [naming.md](naming.md) | Files, folders, identifiers |
| [structure.md](structure.md) | Folder layout and who may import whom |
| [library-calls.md](library-calls.md) | Which file may import which third-party library |
| [react.md](react.md) | Components, effects, hooks |
| [state-and-data.md](state-and-data.md) | Server state, client state, stores |
| [api-calls.md](api-calls.md) | How the app talks to the daemon |
| [design-system.md](design-system.md) | Components, icons, colours |
| [i18n-errors-time.md](i18n-errors-time.md) | Strings, errors, dates |
| [security.md](security.md) | Trust boundaries and hardening |
| [testing.md](testing.md) | What must be tested and where tests live |
