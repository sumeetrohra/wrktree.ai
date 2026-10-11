# React (apps/mobile)

The app runs with the React Compiler, which memoises automatically. Components must therefore be
pure, and most of what effects and memo hooks used to do has a better home.

## Components

| Id | Rule | Enforced by |
|---|---|---|
| R1 | Components are pure and idempotent: same props + state → same output. No reads of mutable globals, `Math.random()`, `Date.now()` or refs during render. | `lint:react-hooks/purity`, `lint:react-hooks/refs` |
| R2 | Never mutate props or state; build new objects and arrays. | `lint:react-hooks/immutability`, `review` |
| R3 | No `setState` during render. | `lint:react-hooks/set-state-in-render` |
| R4 | One exported component per file, named like the file (`repo-list.tsx` → `RepoList`). | `lint:react/no-multi-comp`, `review` |
| R5 | Components receive data and callbacks through props; they don't fetch. Data comes from a page or a module hook. | `review` |

## Effects

| Id | Rule | Enforced by |
|---|---|---|
| R6 | `useEffect` and `useLayoutEffect` are banned. Instead: server data → React Query hooks; client state → Zustand; reacting to a user action → the event handler; derived values → compute during render. | `lint:no-restricted-syntax` |
| R7 | The only accepted exceptions are subscriptions to external systems (the daemon event bridge, app state, keyboard) and imperative native APIs. Each lives in a `use-*.ts` hook with `// eslint-disable-next-line no-restricted-syntax -- reason: …` and a cleanup function. | `lint:eslint-comments/require-description`, `review` |

## Hooks

| Id | Rule | Enforced by |
|---|---|---|
| R8 | Allowed in components: `useState` (local UI state only), `useRef` (imperative handles), Zustand selectors, React Query hooks from a module's `api/`, `useTranslation`, router hooks, and custom `use-*` hooks. | `lint:no-restricted-imports`, `review` |
| R9 | `createContext` / `useContext` are banned; use a Zustand store. | `lint:no-restricted-imports` |
| R10 | `memo`, `useMemo`, `useCallback` are banned; the compiler handles memoisation. | `lint:no-restricted-imports` |
| R11 | Rules of Hooks: top level only, same order every render. | `lint:react-hooks/rules-of-hooks` |
| R12 | Custom hooks live in `hooks/` (module or shared) as `use-*.ts` and return a typed object (`TUse<Thing>Return`). | `lint:check-file`, `review` |
| R13 | `"use no memo"` only with a comment explaining why the compiler cannot handle that component. | `review` |
