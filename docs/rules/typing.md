# Typing

| Id | Rule | Enforced by |
|---|---|---|
| TY1 | All packages extend `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`. Packages may not relax them. | `tsc`, `review` |
| TY2 | Lint runs with type information: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`. | `lint` |
| TY3 | Exported functions and methods declare their return types. | `lint:@typescript-eslint/explicit-module-boundary-types` |
| TY4 | `switch` over a union handles every member (or has a typed `default` that proves exhaustiveness). | `lint:@typescript-eslint/switch-exhaustiveness-check` |
| TY5 | Types that describe data come from zod schemas: `export const fooSchema = z.object(…)`, `export type TFoo = z.infer<typeof fooSchema>`. Never hand-write a type that duplicates a schema. | `review` |
| TY6 | Trust boundaries parse, never cast: WebSocket frames, ACP messages from agents, `.agentdeck/config.json`, JSON files on disk, CLI arguments, environment variables, HTTP bodies. Use `parseJson(schema, text)` from `@agentdeck/shared`; bare `JSON.parse` is banned elsewhere. | `lint:no-restricted-syntax`, `review` |
| TY7 | `import type` for type-only imports. | `lint:@typescript-eslint/consistent-type-imports` |
| TY8 | Prefer `type` over `interface` for shapes. Use `interface` (prefixed `I`) for contracts a class implements: ports, services, sinks. | `lint:@typescript-eslint/consistent-type-definitions` (type), `review` |
| TY9 | No `enum` unless a value must exist at runtime and a zod enum or `as const` object will not do. If you add one, prefix it `E` with `UPPER_SNAKE` members. | `review`, `lint:@typescript-eslint/naming-convention` |
| TY10 | Read-only by default: `readonly` arrays and fields in public types where callers must not mutate. | `review` |
| TY11 | Generated code (RN Reusables components, future API codegen) is not edited by hand and is excluded from lint. | `review` |
