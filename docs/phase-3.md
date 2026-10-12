# Phase 3: Cloud history, review, code, preview

Goal (from [`tech-spec.md`](tech-spec.md)): judge and test an agent's work without a laptop. And
first, chats outlive the computer they ran on.

| Milestone | What | Status |
|---|---|---|
| **3a** | Cloud chat history: every device signs in to Firebase, computers included; hosts write worktrees, chats, items and files to Firestore and Storage; the app reads them when the host is offline | **built** (tested against the Firebase emulators; a real project is pending) |
| **3b** | Changes, Files, Logs tabs; commit, push, PR (agent-drafted body), merge; scripts; open in editor | next |
| **3c** | Preview through a relay TLS tunnel | planned |

## 3a: cloud chat history

```
packages/firebase-rest/   Identity Toolkit sign-in + refresh, Firestore REST (commit, get, query, list), Storage
firebase/                 firebase.json (emulators), firestore.rules, storage.rules
apps/daemon/              modules/cloud (outbox, sync, backfill), app/cloud-store.utils.ts
apps/mobile/              lib/cloud, the Work view's offline hosts, the read-only chat history
e2e/                      scenario 16 (relay + phone-sim), app scenario 17 (web build)
```

### Every device signs in

`agentdeck login` signs the computer in to Firebase with an email link (the same REST flow as the
app), or with `--dev <uid>` against the relay's dev issuer or the Auth emulator. The daemon
registers with the relay using the ID token, like a phone; the link-code approval is gone and
`account.link` is deprecated. The relay's `GET /v1/config` hands out the Firebase project
settings, so a device only needs the relay URL. The Firebase refresh token is sealed next to the
relay device token (`relay-token.sealed`, 0600).

### Data model

All under `users/{uid}` in Firestore; the security rules allow a user only their own subtree.

| Path | What |
|---|---|
| `hosts/{hostId}` | name, last seen |
| `worktrees/{hostId}__{worktreeId}` | repo, branch, base, title, status; `deletedAt` once deleted on the host |
| `chats/{chatId}` | host, `worktreeKey`, agent, profile, model, title, status, timestamps |
| `chats/{chatId}/items/{itemId}` | the protocol's chat item with patches folded in, `seq`; attachments and diffs carry `storagePath` |

Files (images, diffs) go to Storage at `users/{uid}/blobs/{sha256}`, uploaded once per content
hash. Rules cap an object below 50 MB.

### How a host syncs

- `CloudSync` follows the event bus (`chat.item`, `chat.itemPatch`, `chat.status`,
  `worktree.updated`, `worktree.removed`) and queues writes in a durable SQLite outbox
  (migration 4), keyed by document path: patches to one item coalesce, so a streaming reply costs
  about one write per second.
- The outbox flushes every second in batches of up to 400 writes, with exponential backoff while
  Firebase is unreachable; pending writes survive restarts. Document ids are deterministic, so
  retries are idempotent.
- On first sign-in it backfills existing worktrees and chats from the event logs, and replays each
  repo's log so a worktree deleted earlier still gets `deletedAt`. Chats of a worktree deleted
  before that first sync are not backfilled (deleting a worktree deletes its chats locally).
  Signing out, or in as another account, clears the outbox.
- Deleting a worktree marks its document `deletedAt`; its chats and files stay. A later decision
  may prune them.

### The app

The Work view merges live hosts (over the relay) with Firestore: a host that is offline, or no
longer on the account, still lists its branches and chats under "From cloud history", and deleted
worktrees are marked. Opening such a chat shows its history from Firestore, read-only, with images
loaded from Storage.

### Trust

Cloud history is **plaintext** in Firestore and Storage, protected by the security rules (only the
signed-in uid). Google and the Firebase project's admins can read it. The relay still never sees
plaintext (SEC13); see SEC19 in [`rules/security.md`](rules/security.md).

## E2E

Both run under the Firebase Emulator Suite (Auth, Firestore, Storage; needs Java 21):

```sh
pnpm build && pnpm --filter @agentdeck/mobile export:web
pnpm emulators "pnpm --filter @agentdeck/firebase-rest test"
pnpm emulators "CLOUD_E2E=1 APP_E2E=1 pnpm --filter @agentdeck/e2e exec vitest run src/cloud.test.ts src/cloud-app.test.ts"
pnpm emulators "CLOUD_E2E=1 pnpm e2e:record"   # the videos, cloud scenarios included
```

| # | Scenario | Checks |
|---|---|---|
| 16 | Chats outlive the computer | a host backfills a chat made before sign-in; a prompt with a screenshot reaches Firestore and Storage; with the host killed, the phone reads every item in order and downloads the screenshot byte for byte; deleting the worktree marks it `deletedAt` and keeps the chat; another account gets 403 from Firestore and Storage |
| 17 | The app: an offline computer's chats | the laptop syncs two worktrees (one deleted) and is killed; the Work view lists both branches and chats from the cloud and marks the deleted one; the chat opens read-only with the whole turn |

CI runs them in the `cloud history (Firebase emulators)` job; the `record` job records them into
`e2e.mp4` and `app-e2e.mp4`.

## Try it by hand

1. Create a Firebase project with Email link sign-in, Firestore and Storage; deploy
   `firebase/firestore.rules` and `firebase/storage.rules`.
2. Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` and `FIREBASE_STORAGE_BUCKET` on the relay (see
   the README's configuration table).
3. `agentdeck login` on a computer, sign in on the phone with the same email, run a chat.
4. Stop the daemon: the chat is still on the phone, read-only, images included.

Pending: steps 1–4 against a real Firebase project.
