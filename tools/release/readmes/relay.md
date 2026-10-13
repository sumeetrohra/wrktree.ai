# @agentdeck/relay

The Agentdeck relay, to self-host. It routes your devices' end-to-end encrypted frames, buffers
them for offline phones, sends content-free push wake-ups and (optionally) tunnels app previews.
It never sees chat content.

```sh
npm install -g @agentdeck/relay
RELAY_PUBLIC_URL=https://relay.example.com FIREBASE_PROJECT_ID=my-project agentdeck-relay
```

Put TLS in front of it. Settings, Docker and Cloudflare Workers deployments:
https://github.com/sumeetrohra/wrktree.ai/blob/main/docs/relay-deploy.md. MIT licensed.
