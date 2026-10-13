import type { TRelayConfig } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";

import { DevIdTokens, EmulatorIdTokens, FirebaseVerifier } from "#src/infra/idtoken/index.js";
import { DevPushSender, ExpoPushSender } from "#src/infra/push/index.js";
import type { IDirectory } from "#src/modules/directory/index.js";
import type { IClock } from "#src/shared/clock.types.js";
import type { IIdTokenVerifier, TIdentityClaims } from "#src/shared/id-token.types.js";
import { previewDomains, previewUrl } from "#src/shared/preview-host.utils.js";
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

/** The public client configuration devices fetch at `GET /v1/config`. */
function configFor(env: TRelayEnv): TRelayConfig {
  const dev = env.RELAY_DEV === "1";
  const projectId = env.FIREBASE_PROJECT_ID;
  const emulators = dev
    ? {
        ...(env.FIREBASE_AUTH_EMULATOR_HOST === undefined ? {} : { auth: env.FIREBASE_AUTH_EMULATOR_HOST }),
        ...(env.FIRESTORE_EMULATOR_HOST === undefined ? {} : { firestore: env.FIRESTORE_EMULATOR_HOST }),
        ...(env.FIREBASE_STORAGE_EMULATOR_HOST === undefined
          ? {}
          : { storage: env.FIREBASE_STORAGE_EMULATOR_HOST }),
      }
    : {};
  const usingEmulators = Object.keys(emulators).length > 0;
  const firebase =
    projectId === undefined || (env.FIREBASE_API_KEY === undefined && !usingEmulators)
      ? null
      : {
          apiKey: env.FIREBASE_API_KEY ?? "emulator-api-key",
          projectId,
          storageBucket: env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
          ...(usingEmulators ? { emulators } : {}),
        };
  return { firebase, devSignIn: dev };
}

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
    return {
      directory,
      hubs,
      idTokens: firebase,
      devIdTokens: null,
      clock,
      log,
      config: configFor(env),
      preview: previewOf(env),
    };
  }
  if (env.RELAY_DEV_SECRET === undefined) throw new Error("RELAY_DEV_SECRET is required when RELAY_DEV=1");
  const dev = new DevIdTokens(env.RELAY_DEV_SECRET);
  const emulator =
    env.FIREBASE_AUTH_EMULATOR_HOST !== undefined && env.FIREBASE_PROJECT_ID !== undefined
      ? new EmulatorIdTokens(env.FIREBASE_PROJECT_ID)
      : null;
  const verifiers: IIdTokenVerifier[] = [dev];
  if (emulator) verifiers.push(emulator);
  else if (firebase) verifiers.push(firebase);
  return {
    directory,
    hubs,
    idTokens: anyOf(verifiers),
    devIdTokens: dev,
    clock,
    log,
    config: configFor(env),
    preview: previewOf(env),
  };
}

function previewOf(env: TRelayEnv): TRelayDeps["preview"] {
  return { domains: previewDomains(env), urlFor: (token, base) => previewUrl(token, env, base) };
}

export function buildPushSender(env: TRelayEnv, directory: Pick<IDirectory, "recordPush">): IPushSender {
  return env.RELAY_DEV === "1"
    ? new DevPushSender((p) => directory.recordPush(p))
    : new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
}
