import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function repoHandlers(m: TModules): Pick<THandlers, "repo.list" | "repo.add" | "repo.remove" | "fs.browse"> {
  return {
    "repo.list": () => m.repos.list(),
    "repo.add": (a) => m.repos.add(a.path),
    "repo.remove": (a) => {
      m.repos.remove(a.repoId);
      return {};
    },
    "fs.browse": (a) => m.repos.browse(a.path),
  };
}
