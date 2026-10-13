import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";
import { localOnly } from "../local-only.utils.js";

/**
 * Phase 4c: the config every profile shares. Instructions can be edited from any device; MCP
 * servers start commands on this computer, so changing them, or dropping a profile's override, is
 * local only (SEC24).
 */
export function configHandlers(
  m: TModules,
): Pick<
  THandlers,
  "config.shared.get" | "config.shared.set" | "profile.overrides" | "profile.removeOverride"
> {
  return {
    "config.shared.get": () => m.profiles.sharedConfig(),
    "config.shared.set": (a, ctx) => {
      if (a.mcpServers !== undefined) localOnly(ctx);
      return m.profiles.setSharedConfig(a);
    },
    "profile.overrides": (a) => ({ files: m.profiles.overrides(a.profileId) }),
    "profile.removeOverride": (a, ctx) => {
      localOnly(ctx);
      m.profiles.removeOverride(a.profileId, a.name);
      return {};
    },
  };
}
