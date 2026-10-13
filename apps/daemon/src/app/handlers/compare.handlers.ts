import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";
import { pickCompare, startCompare } from "../compare.utils.js";

export function compareHandlers(
  m: TModules,
): Pick<THandlers, "compare.start" | "compare.list" | "compare.get" | "compare.pick"> {
  return {
    "compare.start": (a) => startCompare(m, a),
    "compare.list": (a) => m.compare.list(a.repoId),
    "compare.get": (a) => m.compare.get(a.compareId),
    "compare.pick": (a) => pickCompare(m, a.compareId, a.worktreeId),
  };
}
