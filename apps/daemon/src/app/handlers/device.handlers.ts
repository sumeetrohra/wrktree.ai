import { AgentdeckError } from "@agentdeck/protocol";

import type { TCommandContext, THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

/** Pairing hands out the QR secret: only clients on this machine may drive it. */
function localOnly(ctx: TCommandContext): void {
  if (!ctx.deviceId.startsWith("local-")) {
    throw new AgentdeckError("UNAUTHORIZED", "Pairing is only available on the desktop");
  }
}

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
> {
  return {
    "device.list": () => m.devices.list(),
    "device.revoke": (args) => m.remote.revoke(args.deviceId),
    "pair.start": (_args, ctx) => {
      localOnly(ctx);
      return m.remote.pairing().start();
    },
    "pair.status": (args, ctx) => {
      localOnly(ctx);
      return m.remote.pairing().status(args.pairingId);
    },
    "pair.confirm": (args, ctx) => {
      localOnly(ctx);
      m.remote.pairing().confirm(args.pairingId, args.accept);
      return {};
    },
    "relay.status": () => m.remote.status(),
    "web.open": (_args, ctx) => {
      localOnly(ctx);
      return { url: m.webLink() };
    },
  };
}
