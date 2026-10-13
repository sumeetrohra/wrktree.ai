# Maestro flows (native app)

The same journeys as the Playwright app scenarios, for a development build on an iOS simulator or
Android emulator. They need a running dev relay and daemon (README, "Run it").

```sh
eas build --profile development --platform ios   # or android; once
maestro test -e RELAY_URL=http://10.0.2.2:8787 e2e/maestro/sign-in.yaml
pnpm agentdeck login --dev me                    # the computer signs in as the same user
maestro test e2e/maestro/chat.yaml
maestro test e2e/maestro/image-attach.yaml
maestro test e2e/maestro/push-deep-link.yaml
maestro test e2e/maestro/terminal.yaml        # Phase 5a
maestro test e2e/maestro/sealed-preview.yaml  # Phase 5e: the page loads from the app's own server
```
