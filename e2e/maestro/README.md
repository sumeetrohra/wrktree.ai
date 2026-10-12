# Maestro flows (native app)

The same journeys as the Playwright app scenarios, for a development build (with
`EXPO_PUBLIC_DEV_AUTH=1`) on an iOS simulator or Android emulator. They need a running relay and
daemon (`docs/phase-2.md`, 2c "Try it by hand").

```sh
eas build --profile development --platform ios   # or android; once
agentdeck login --print                          # prints the code to approve
maestro test -e RELAY_URL=http://10.0.2.2:8787 -e LINK_CODE=ABCD-EFGH e2e/maestro/sign-in-and-link.yaml
maestro test e2e/maestro/chat.yaml
maestro test e2e/maestro/image-attach.yaml
maestro test e2e/maestro/push-deep-link.yaml
```
