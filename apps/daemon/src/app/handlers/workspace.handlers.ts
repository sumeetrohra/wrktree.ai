import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function workspaceHandlers(m: TModules): Pick<THandlers, "workspace.overview"> {
  return {
    "workspace.overview": () => {
      const worktrees = m.worktrees.all();
      return {
        host: { deviceId: m.remote.status().deviceId, name: m.remote.hostName },
        repos: m.repos.list(),
        worktrees,
        chats: worktrees.flatMap((wt) => m.sessions.list(wt.id)),
        profiles: m.profiles.list(),
      };
    },
  };
}
