import type { THandlers } from "#src/infra/rpc/index.js";
import { DAEMON_VERSION } from "#src/shared/version.constants.js";

import type { TModules } from "../app.types.js";

export function syncHandlers(m: TModules): Pick<THandlers, "sync.hello"> {
  return {
    "sync.hello": (args, ctx) => {
      const topics: Record<string, number> = {};
      for (const pattern of Object.keys(args.cursors)) {
        const list = pattern.endsWith(":*") ? m.bus.topics(pattern) : [pattern];
        for (const t of list) topics[t] = m.bus.cursor(t);
      }
      ctx.afterReply(() => {
        ctx.subscribe(args.cursors);
      });
      return { daemonId: m.daemonId, daemonVersion: DAEMON_VERSION, topics };
    },
  };
}
