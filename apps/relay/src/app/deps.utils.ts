import type { ILogger } from "@agentdeck/shared";

import { DevIdTokens, FirebaseVerifier } from "#src/infra/idtoken/index.js";
import { DevPushSender, ExpoPushSender } from "#src/infra/push/index.js";
import type { IDirectory } from "#src/modules/directory/index.js";
import type { IClock } from "#src/shared/clock.types.js";
import type { IIdTokenVerifier, TIdentityClaims } from "#src/shared/id-token.types.js";
import type { IPushSender } from "#src/shared/push.types.js";
import type { TRelayEnv } from "#src/shared/relay-env.schema.js";

import type { IHubs, TRelayDeps } from "./app.types.js";

/** Tries each verifier in turn: in dev, both the dev issuer and (if configured) Firebase. */
const anyOf = (verifiers: IIdTokenVerifier[]): IIdTokenVerifier => ({
  async verify(token: string): Promise<TIdentityClaims | null> {
    for (const v of verifiers) {
      const claims = await v.verify(token);
      if (claims) return claims;
    }
    return null;
  },
});

/** Production adapters, or the dev issuer and recording push sender when RELAY_DEV=1. Fails fast. */
export function buildDeps(
  env: TRelayEnv,
  directory: IDirectory,
  hubs: IHubs,
  clock: IClock,
  log: ILogger,
): TRelayDeps {
  const firebase =
    env.FIREBASE_PROJECT_ID === undefined ? null : new FirebaseVerifier(env.FIREBASE_PROJECT_ID);
  if (env.RELAY_DEV !== "1") {
    if (!firebase) throw new Error("FIREBASE_PROJECT_ID is required unless RELAY_DEV=1");
    return { directory, hubs, idTokens: firebase, devIdTokens: null, clock, log };
  }
  if (env.RELAY_DEV_SECRET === undefined) throw new Error("RELAY_DEV_SECRET is required when RELAY_DEV=1");
  const dev = new DevIdTokens(env.RELAY_DEV_SECRET);
  const idTokens = anyOf(firebase ? [dev, firebase] : [dev]);
  return { directory, hubs, idTokens, devIdTokens: dev, clock, log };
}

export function buildPushSender(env: TRelayEnv, directory: Pick<IDirectory, "recordPush">): IPushSender {
  return env.RELAY_DEV === "1"
    ? new DevPushSender((p) => directory.recordPush(p))
    : new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
}
