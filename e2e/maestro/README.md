# Maestro flows (native app)

The same journeys as the Playwright app scenarios, for a development build on an iOS simulator
or Android emulator. They need a running daemon and relay (`docs/phase-2.md`, "Try it by hand")
and a pairing link from `agentdeck pair`.

```sh
eas build --profile development --platform ios   # or android; once
maestro test -e PAIR_LINK="agentdeck://pair?o=…" -e EMAIL=me@example.com e2e/maestro/pairing.yaml
maestro test e2e/maestro/chat.yaml
maestro test e2e/maestro/image-attach.yaml
maestro test e2e/maestro/push-deep-link.yaml
```

Read the sign-in code from the relay's dev outbox (`GET /v1/dev/outbox` with `RELAY_DEV=1`) and pass
it as `-e CODE=…` to `pairing.yaml`.
