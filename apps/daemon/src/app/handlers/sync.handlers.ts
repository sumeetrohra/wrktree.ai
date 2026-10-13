import type { THandlers } from "#src/infra/rpc/index.js";
import { DAEMON_VERSION } from "#src/shared/version.constants.js";

import type { TModules } from "../app.types.js";
import { isLocalDevice } from "../local-only.utils.js";

export function syncHandlers(m: TModules): Pick<THandlers, "sync.hello"> {
  return {
    "sync.hello": (args, ctx) => {
      // Terminal output is only for devices that may use terminals here (SEC25).
      const termsAllowed = isLocalDevice(ctx) || m.remoteTerminal();
      const cursors = Object.fromEntries(
        Object.entries(args.cursors).filter(([t]) => termsAllowed || !t.startsWith("term:")),
      );
      const topics: Record<string, number> = {};
      for (const pattern of Object.keys(cursors)) {
        const list = pattern.endsWith(":*") ? m.bus.topics(pattern) : [pattern];
        for (const t of list) topics[t] = m.bus.cursor(t);
      }
      ctx.afterReply(() => {
        ctx.subscribe(cursors);
      });
      return { daemonId: m.daemonId, daemonVersion: DAEMON_VERSION, topics };
    },
  };
}
