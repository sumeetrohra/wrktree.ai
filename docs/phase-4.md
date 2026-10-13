# Phase 4: Accounts power and launch

Goal (from [`tech-spec.md`](tech-spec.md)): several accounts of one agent, used to their limits,
and a public launch. Decisions: MIT everywhere, no billing or plan limits, store-ready config
(submissions are the owner's), a landing page and docs site, npm publishing.

| Milestone | What | Status |
|---|---|---|
| **4a** | Usage and limits per profile | **built** |
| **4b** | Hand-off to another profile or agent | planned |
| **4c** | Shared config (MCP, skills, instructions) | planned |
| **4d** | Windows hardening, keep-awake, `uninstall`/`status`/`doctor` | planned |
| **4e** | Open source files, npm packages, docker-compose | planned |
| **4f** | Store-ready app, Sentry | planned |
| **4g** | Landing page and docs site | planned |

## 4a: usage and limits per profile

### Detecting a limit

Each agent reports limits in its own words, as an adapter error or (Claude Code) as its reply.
`modules/agents/limit-text.utils.ts` reads both, with the reset time when the text gives one:

| Shape | Example | Reset |
|---|---|---|
| epoch after a bar | `Claude AI usage limit reached\|1760400000` | that time |
| clock time | `5-hour limit reached ∙ resets 3pm`, `Try again at 11:45 PM` | the next such time here |
| duration | `try again in 2 hours 13 minutes`, `Please retry in 12.5s` | now + duration |
| Google API | `"retryDelay": "37s"` | now + delay |
| ISO time | `resets at 2026-10-13T18:00:00Z` | that time |

A reply only counts as a limit when it is short (≤ 500 characters) and reads like a limit notice,
so an answer *about* rate limiting doesn't stop the chat.

### Counting

`modules/usage` keeps `usage_samples` (migration 5 adds per-chat running totals):

- Every completed turn records its tokens: ACP reports a session's running totals in the prompt
  response (`usage`, where the adapter sends it); the growth since the last turn is this turn's.
- A limit records the time and reset; it lasts until the reset time, or until a turn on that
  profile completes. Without a reset time the chat retries its queue after 15 minutes.
- Each change publishes `usage.updated` with the profile's snapshot; `profile.usage {profileId}`
  returns it: `limitHit`, `resetAt`, `limitedAt`, and today's `inputTokens`/`outputTokens`.

### Chats at a limit

A limited chat **queues** messages instead of refusing them; the queue goes out when the limit
resets. Every `chat.status` `limited` event carries `resetAt`.

### In the app

- The chat shows a banner while its profile is limited, with when it resets.
- Settings lists each online computer's profiles: available or at its limit (resets in …), and
  today's tokens.

### Tests

| # | Scenario | Checks |
|---|---|---|
| 4 | Chat lifecycle (extended) | a send while limited is queued and goes out at the reset; `profile.usage` shows the limit lifted and today's tokens |
| 23 | Usage limits from the phone | today's tokens per profile; a limit the agent states in its reply, with its reset time; a message queued while limited goes out at the reset; the limit lifts |
| 24 (app) | The app: a profile at its usage limit | the banner with "resets in …"; a message typed meanwhile shows as queued and goes out at the reset; Settings shows the profile at its limit, then available with today's tokens |

Unit tests cover the reset-time shapes above, the reply heuristic and the counting rules.
Pending: samples from real Claude Code, Codex and Gemini limits (the shapes above are from their
documented messages).
