# Deploying the relay

The relay has two builds of the same code: a Cloudflare Worker with Durable Objects (the hosted
relay) and a Node server (self-host). Both read the settings below.

Users sign in with [Firebase Auth](https://firebase.google.com/docs/auth) on their phones and
browsers; the relay only verifies the resulting ID tokens (RS256, Google's public keys, `iss` and
`aud` naming your project). It holds no sign-in secrets of its own.

| Variable | Needed | What |
|---|---|---|
| `FIREBASE_PROJECT_ID` | production | The Firebase project whose ID tokens sign users in. |
| `RELAY_PUBLIC_URL` | always | The relay's public base URL. |
| `EXPO_ACCESS_TOKEN` | optional | Expo push API access token (if push security is enabled on the Expo project). |
| `RELAY_DEV` | dev only | `1` mounts the dev ID-token issuer (`GET /v1/dev/id-token?uid=…`, standing in for Firebase) and recorded pushes (`GET /v1/dev/pushes`). Never set it in production. |
| `RELAY_DEV_SECRET` | dev only | 32+ characters; signs dev ID tokens. Read only with `RELAY_DEV=1`. |

Without `RELAY_DEV=1`, the relay refuses to start unless `FIREBASE_PROJECT_ID` is set. Every key,
with its default, is in the root [`.env.example`](../.env.example); `pnpm relay` loads `.env`.

## Firebase

1. Create a Firebase project and enable **Authentication → Email link (passwordless)**. Add the web
   app's domain to the authorized domains.
2. Give the relay the project id (`FIREBASE_PROJECT_ID`), and build the app with the project's Web
   API key: `EXPO_PUBLIC_FIREBASE_API_KEY=… EXPO_PUBLIC_RELAY_URL=https://relay.example.com`.
3. Computers never sign in themselves: `agentdeck login` shows a code that a signed-in phone or
   browser approves.

## Cloudflare (hosted)

```sh
cd apps/relay
pnpm build                                   # wrangler deploys dist/main.worker.js
npx wrangler login
npx wrangler secret put EXPO_ACCESS_TOKEN --env staging   # optional
npx wrangler deploy --env staging            # FIREBASE_PROJECT_ID is a var in wrangler.toml
```

`wrangler.toml` declares the `DirectoryDO` and `HubDO` Durable Object classes on SQLite storage.
Put the Worker on a custom domain and set `RELAY_PUBLIC_URL` to it.

Local development of the Worker build: `pnpm --filter @agentdeck/relay dev:worker` (dev env, port
8787). The relay contract tests run against it with `RELAY_WORKER_TESTS=1 pnpm --filter
@agentdeck/relay test`.

## Self-host (Docker)

```sh
docker build -f apps/relay/Dockerfile -t agentdeck-relay .
docker run -d -p 8787:8787 -v agentdeck-relay:/data \
  -e RELAY_PUBLIC_URL=https://relay.example.com -e FIREBASE_PROJECT_ID=my-project agentdeck-relay
```

Terminate TLS in front of it (Caddy, nginx, a load balancer). Data lives in `/data`: one SQLite
file for the directory and one per account hub. Then point daemons at it with
`agentdeck relay set https://relay.example.com` and link each with `agentdeck login`.
