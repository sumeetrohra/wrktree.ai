# State and data (apps/mobile)

| Id | Rule | Enforced by |
|---|---|---|
| D1 | Daemon data (repos, worktrees, chats, diffs, files) is server state and lives in React Query. Never copy it into Zustand or `useState`. | `review` |
| D2 | Client-only UI state (open sheets, selected tab, filters, drafts) lives in Zustand stores. | `review` |
| D3 | Stores live in `stores/<domain>.store.ts`, export `use<Domain>Store`, separate state from actions in their type, keep actions synchronous, and name every `set` for devtools. | `lint:check-file`, `review` |
| D4 | Components read stores through selectors (`useChatStore((s) => s.draft)`), never by destructuring the whole store. | `review` |
| D5 | Async work (daemon calls) lives in query/mutation hooks, which call store actions when they finish. | `review` |
| D6 | Each module owns a query-key factory in `api/<module>.keys.ts`; no inline key arrays. | `review` |
| D7 | After a mutation, invalidate the affected keys; don't hand-edit the cache with `setQueryData`. Daemon events also invalidate through the event bridge in `lib/api`. | `review` |
| D8 | Exception: the live chat stream (items and patches arriving many times a second) is kept in a normalised per-chat Zustand store fed by the event bridge, as the tech spec specifies. Nothing else may bypass React Query. | `review` |
| D9 | Every query consumer handles loading, error and success. | `review` |
