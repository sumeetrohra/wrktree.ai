# Strings, errors and time

| Id | Rule | Enforced by |
|---|---|---|
| I1 | Every user-facing string in the app goes through `t()` from `useTranslation()`, with keys in `shared/i18n/locales/en.json`. No string literals in JSX. | `lint:no-restricted-syntax` |
| I2 | No `new Date()` in the app; use `now()`, `parseDate()`, `formatDate()` from `shared/utils/datetime-utils.ts`. The daemon and protocol carry time as epoch milliseconds (`now()` from `@agentdeck/shared`). | `lint:no-restricted-syntax` |
| I3 | The daemon throws `AgentdeckError` with a protocol `ErrorCode`; the router turns it into a `TProtocolError`. Never throw bare strings. | `lint:@typescript-eslint/only-throw-error` |
| I4 | The app turns protocol errors into `AppError` (code + i18n key) in `lib/api`; screens show them with a toast or an error state, never raw messages. | `review` |
| I5 | Errors are reported through a `modules/sentry` wrapper (added with the Sentry DSN in Phase 2); nothing calls the Sentry SDK directly (L8). | `lint:no-restricted-imports` |
| I6 | Catch variables are `unknown` and narrowed before use. | `tsc` (`useUnknownInCatchVariables`) |
