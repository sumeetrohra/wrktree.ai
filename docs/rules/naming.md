# Naming

| Id | Rule | Enforced by |
|---|---|---|
| N1 | Type aliases start with `T`: `TRepo`, `TChatStatus`, `TButtonProps`. | `lint:@typescript-eslint/naming-convention` |
| N2 | Interfaces start with `I`: `ILogger`, `IRepoSource`. | `lint:@typescript-eslint/naming-convention` |
| N3 | Enums start with `E` and their members are `UPPER_SNAKE_CASE`. | `lint:@typescript-eslint/naming-convention` |
| N4 | Zod schemas are camelCase values ending in `Schema`: `repoSchema`, `chatItemSchema`. | `lint:@typescript-eslint/naming-convention`, `review` |
| N5 | Module-level constants that never change are `UPPER_SNAKE_CASE` (`MAX_UPLOAD_BYTES`); other variables and functions are `camelCase`; classes and React components `PascalCase`. | `lint:@typescript-eslint/naming-convention` |
| N6 | Files and folders are kebab-case. React component files too: `repo-list.tsx` exports `RepoList`. | `lint:check-file/filename-naming-convention`, `lint:check-file/folder-naming-convention` |
| N7 | File suffixes say what a file holds: `.service.ts` (a module's main class), `.types.ts` (types and ports only), `.schema.ts` (zod schemas), `.constants.ts`, `.utils.ts` (pure helpers), `.store.ts` (Zustand), `.queries.ts` (React Query hooks), `.handlers.ts` (daemon command handlers), `.command.ts` (CLI commands), `.test.ts`/`.test.tsx`. Hooks are `use-*.ts`. | `lint:check-file/filename-naming-convention`, `review` |
| N8 | Stores are named `use<Domain>Store` in `<domain>.store.ts`. Hooks are named `use<Thing>`. | `review` |
| N9 | Props types are `T<Component>Props`; hook return types are `TUse<Thing>Return`. | `review` |
| N10 | Booleans read as questions: `isReady`, `hasChanges`, `canEdit`. | `review` |
