# Golden rules

The highest-priority rules. Never break them.

| Id | Rule | Enforced by |
|---|---|---|
| G1 | No `any`, explicit or implicit. Use `unknown` and narrow it. | `lint:@typescript-eslint/no-explicit-any`, `lint:@typescript-eslint/no-unsafe-*`, `tsc` |
| G2 | No non-null assertions (`x!`). Narrow or validate instead. | `lint:@typescript-eslint/no-non-null-assertion` |
| G3 | No type assertions (`x as T`) except `as const`. Parse unknown data with zod; narrow everything else. | `lint:@typescript-eslint/consistent-type-assertions` |
| G4 | No `console.*`. The daemon logs through `infra/log`; the app reports through `modules/sentry`; CLI output goes through `shared/output`. | `lint:no-console` |
| G5 | Named exports only. The single exception is Expo Router route files in `apps/mobile/src/app/`, which must default-export a page. | `lint:import-x/no-default-export` |
| G6 | Never swallow an error. Every `catch` re-throws, returns a typed error, or reports it. | `lint:no-empty`, `lint:@typescript-eslint/no-floating-promises`, `review` |
| G7 | Every promise is awaited, returned, or explicitly `void`-ed with a reason. | `lint:@typescript-eslint/no-floating-promises`, `lint:@typescript-eslint/no-misused-promises` |
| G8 | Modules never import other modules. Pages (app) and handlers (daemon) compose modules. | `lint:no-restricted-imports` |
| G9 | Third-party I/O libraries are called only through their wrapper file. | `lint:no-restricted-imports` ([library-calls.md](library-calls.md)) |
| G10 | Data crossing a trust boundary is validated with zod before use. | `lint:no-restricted-syntax` (bare `JSON.parse`), `review` |
| G11 | The protocol package is the single source of truth for commands and events. Every command has exactly one handler; the app client is typed from the same map. | `tsc` |
| G12 | No `@ts-ignore`; `@ts-expect-error` only with a description. | `lint:@typescript-eslint/ban-ts-comment` |
