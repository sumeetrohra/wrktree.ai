# Data safety and privacy answers

For App Store Connect (App Privacy) and Google Play (Data safety). Keep in step with
[`docs/privacy.md`](../../../docs/privacy.md) and [`docs/rules/security.md`](../../../docs/rules/security.md).

## What the app collects

| Data | Collected? | Why | Linked to the user? | Shared? |
|---|---|---|---|---|
| Email address | Yes | Sign-in (Firebase Authentication) | Yes | No |
| User ID | Yes | The account's device list on the relay; chat history in Firestore | Yes | No |
| Device ID (a key pair made on the device) | Yes | Routing end-to-end encrypted messages to this device | Yes | No |
| Push token | Yes | Content-free "a session needs you" notifications | Yes | No |
| Chat messages, code, files | Stored in your own Firebase project's Firestore/Storage (cloud history) | So chats stay readable when the computer is off | Yes | No |
| Crash reports | Only in builds with a Sentry DSN | App stability; no message text, no user, no request data (SEC8) | No | No |
| Audio (microphone) | No: dictation is recognized on the device and only the resulting text is sent, as a chat message | Dictating a message | | No |
| Location, contacts, health, financial, browsing | No | | | |
| Advertising ID, tracking | No | No ads, no tracking | | |

- **Encryption in transit:** yes. Messages between the phone and computers are end-to-end
  encrypted (X25519 + XChaCha20-Poly1305); everything else uses TLS.
- **Deletion:** removing a device or signing out deletes its keys from the device; deleting the
  account removes its devices from the relay and its Firestore data (see `docs/privacy.md`).
- **Previews** (Phase 3c) go through the relay over TLS only, not end to end: the relay operator
  can see preview traffic. It's off unless a repo turns it on.

## Apple specifics

- **Export compliance:** the app uses standard encryption (TLS and libsodium-style primitives for
  end-to-end messaging). Answer the encryption questions accordingly; it is exempt under the
  "standard algorithms" provision but may need the annual self-classification report.
- **Sign in:** email link only (no third-party sign-in), so Sign in with Apple isn't required.
- **Review:** reviewers need a computer running the CLI. Give them a demo account on a computer
  you keep online (see `review-notes.md`).
