import { AgentdeckError } from "@agentdeck/protocol";

import type { TCommandContext } from "#src/infra/rpc/index.js";

/**
 * Commands that hand out secrets or act on this computer's desktop (account sign-in, the web UI
 * link, opening an editor): only clients on this machine, never through the relay.
 */
export function localOnly(ctx: TCommandContext): void {
  if (!ctx.deviceId.startsWith("local-")) {
    throw new AgentdeckError("UNAUTHORIZED", "Only available on this computer");
  }
}
