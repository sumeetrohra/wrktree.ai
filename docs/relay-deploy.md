# Deploying the relay

The relay has two builds of the same code: a Cloudflare Worker with Durable Objects (the hosted
relay) and a Node server (self-host). Both read the settings below.

| Variable | Needed | What |
|---|---|---|
| `RELAY_JWT_SECRET` | always | 32+ random characters; signs account sessions. Rotating it signs everyone out. |
| `RELAY_PUBLIC_URL` | always | The relay's public base URL (used in OAuth redirects). |
| `RESEND_API_KEY`, `RELAY_MAIL_FROM` | production | Magic-link email through Resend. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | production | GitHub sign-in (an OAuth app with callback to the app). |
| `EXPO_ACCESS_TOKEN` | optional | Expo push API access token (if push security is enabled on the Expo project). |
| `RELAY_DEV` | dev only | `1` swaps in the dev mailer (`GET /v1/dev/outbox`), dev OAuth (`dev-<login>` codes) and recorded pushes (`GET /v1/dev/pushes`). Never set it in production. |

Without `RELAY_DEV=1`, the relay refuses to start unless the mail and GitHub keys are set.

## Cloudflare (hosted)

```sh
cd apps/relay
pnpm build                                   # wrangler deploys dist/main.worker.js
npx wrangler login
for s in RELAY_JWT_SECRET RESEND_API_KEY GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET EXPO_ACCESS_TOKEN; do
  npx wrangler secret put "$s" --env staging
done
npx wrangler deploy --env staging
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
  -e RELAY_PUBLIC_URL=https://relay.example.com -e RELAY_JWT_SECRET=… \
  -e RESEND_API_KEY=… -e GITHUB_CLIENT_ID=… -e GITHUB_CLIENT_SECRET=… agentdeck-relay
```

Terminate TLS in front of it (Caddy, nginx, a load balancer). Data lives in `/data`: one SQLite
file for the directory and one per account hub. Then point daemons at it with
`agentdeck relay set https://relay.example.com`.
