import { AgentdeckError } from "@agentdeck/protocol";

import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

import { localOnly } from "./local-only.utils.js";

const PAIRING_REMOVED = (): never => {
  throw new AgentdeckError("UNAUTHORIZED", "Pairing was replaced by signing in: run `agentdeck login`");
};

export function deviceHandlers(
  m: TModules,
): Pick<
  THandlers,
  | "device.list"
  | "device.revoke"
  | "pair.start"
  | "pair.status"
  | "pair.confirm"
  | "relay.status"
  | "web.open"
  | "account.link"
  | "account.signIn"
  | "account.completeSignIn"
  | "account.signInDev"
  | "account.status"
  | "account.logout"
> {
  return {
    "device.list": () => m.devices.list(),
    "device.revoke": (args) => m.remote.revoke(args.deviceId),
    "pair.start": PAIRING_REMOVED,
    "pair.status": PAIRING_REMOVED,
    "pair.confirm": PAIRING_REMOVED,
    "relay.status": () => m.remote.status(),
    "web.open": (_args, ctx) => {
      localOnly(ctx);
      return { url: m.webLink() };
    },
    "account.link": () => {
      throw new AgentdeckError(
        "UNAUTHORIZED",
        "Link codes were replaced by signing in: run `agentdeck login`",
      );
    },
    "account.signIn": async (args, ctx) => {
      localOnly(ctx);
      await m.remote.signIn(args.email);
      return {};
    },
    "account.completeSignIn": (args, ctx) => {
      localOnly(ctx);
      return m.remote.completeSignIn(args.link);
    },
    "account.signInDev": (args, ctx) => {
      localOnly(ctx);
      return m.remote.signInDev(args.uid);
    },
    "account.status": () => m.remote.accountStatus(),
    "account.logout": async (_args, ctx) => {
      localOnly(ctx);
      await m.remote.logout();
      return {};
    },
  };
}
