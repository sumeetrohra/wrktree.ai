import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function previewHandlers(m: TModules): Pick<THandlers, "preview.start" | "preview.stop"> {
  return {
    /** The URL depends on who asks: `localhost` here, a relay tunnel only they can open elsewhere. */
    "preview.start": (a, ctx) => m.preview.start(a.worktreeId, ctx.deviceId),
    "preview.stop": async (a) => {
      await m.preview.stop(a.worktreeId);
      return {};
    },
  };
}
