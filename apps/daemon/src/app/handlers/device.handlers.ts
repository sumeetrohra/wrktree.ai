import { AgentdeckError } from "@agentdeck/protocol";

import type { TCommandContext, THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

/** Linking an account and opening the web UI hand out secrets: only clients on this machine. */
function localOnly(ctx: TCommandContext): void {
  if (!ctx.deviceId.startsWith("local-")) {
    throw new AgentdeckError("UNAUTHORIZED", "Only available on this computer");
  }
}

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
    "account.link": (_args, ctx) => {
      localOnly(ctx);
      return m.remote.startLink();
    },
    "account.status": () => m.remote.accountStatus(),
    "account.logout": async (_args, ctx) => {
      localOnly(ctx);
      await m.remote.logout();
      return {};
    },
  };
}
