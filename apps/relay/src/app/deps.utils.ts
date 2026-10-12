import type { ILogger } from "@agentdeck/shared";

import { JwtService } from "#src/infra/jwt/index.js";
import { DevMailer, ResendMailer, type IMailer } from "#src/infra/mail/index.js";
import { DevOAuth, GithubOAuth, type IOAuthProvider } from "#src/infra/oauth/index.js";
import { DevPushSender, ExpoPushSender } from "#src/infra/push/index.js";
import type { IDirectory } from "#src/modules/directory/index.js";
import type { IClock } from "#src/shared/clock.types.js";
import type { IPushSender } from "#src/shared/push.types.js";
import type { TRelayEnv } from "#src/shared/relay-env.schema.js";

import type { IHubs, TRelayDeps } from "./app.types.js";

/** Production adapters, or the recording dev ones when RELAY_DEV=1. Fails fast on missing keys. */
export function buildDeps(
  env: TRelayEnv,
  directory: IDirectory,
  hubs: IHubs,
  clock: IClock,
  log: ILogger,
): TRelayDeps {
  const dev = env.RELAY_DEV === "1";
  let mailer: IMailer;
  let oauth: IOAuthProvider;
  if (dev) {
    mailer = new DevMailer((to, code) => directory.recordOutbox(to, code));
    oauth = new DevOAuth(env.RELAY_PUBLIC_URL);
  } else {
    if (!env.RESEND_API_KEY || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      throw new Error(
        "RESEND_API_KEY, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required unless RELAY_DEV=1",
      );
    }
    mailer = new ResendMailer(env.RESEND_API_KEY, env.RELAY_MAIL_FROM);
    oauth = new GithubOAuth(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET);
  }
  return { directory, hubs, jwt: new JwtService(env.RELAY_JWT_SECRET), mailer, oauth, clock, log, dev };
}

export function buildPushSender(env: TRelayEnv, directory: Pick<IDirectory, "recordPush">): IPushSender {
  return env.RELAY_DEV === "1"
    ? new DevPushSender((p) => directory.recordPush(p))
    : new ExpoPushSender(env.EXPO_ACCESS_TOKEN);
}
