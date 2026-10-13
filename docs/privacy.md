# Privacy policy

_Last updated: 2026-10-13_

Agentdeck is open-source software for driving coding agents on your own computers from your
phone. This policy covers the Agentdeck apps, the `agentdeck` CLI and daemon, and the hosted
relay. If you self-host the relay, you are its operator.

## What we process, and why

- **Your email address,** to sign you in (Firebase Authentication).
- **Your devices:** an ID and public keys for each phone, browser and computer you sign in,
  kept by the relay so your devices can find and verify each other; push tokens, to wake your
  phone with a notification that carries no content.
- **Your chats,** if you use cloud history: chat messages, attached images and diffs are stored
  in Firestore and Cloud Storage under your account, readable only by you (security rules), so
  they stay available when your computer is off. Google, as the hosting provider, could access
  them.
- **Crash reports,** in official builds: the error and its stack trace, without message text,
  your account or request data.

## What we don't do

- The relay never sees your messages: they are end-to-end encrypted between your devices. It
  routes and briefly buffers ciphertext (deleted once delivered, or after 7 days).
- **Exception, Preview:** when you open a preview of an app running on your computer, that
  traffic goes through the relay over TLS only, so the relay can see it. Previews are off unless
  you turn them on for a repo.
- Your code stays on your computers. Agents run there with your own logins; we don't receive
  your agent credentials or API keys.
- No ads, no tracking, no selling or sharing of data.

## Keeping and deleting

Removing a device deletes its relay registration and tokens. Signing out of the CLI removes the
computer from your account. To delete your account and cloud history, email
**privacy@agentdeck.dev**; we delete it within 30 days. Chat history on your computers stays in
the daemon's folder until you delete it.

## Contact

**privacy@agentdeck.dev**. Changes to this policy are listed in the repository's history.
