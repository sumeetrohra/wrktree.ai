import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function procHandlers(
  m: TModules,
): Pick<THandlers, "proc.list" | "proc.start" | "proc.stop" | "proc.output"> {
  return {
    "proc.list": (a) => m.procs.list(a.worktreeId),
    "proc.start": (a) => m.procs.start(a.worktreeId, a.script),
    "proc.stop": (a) => m.procs.stop(a.procId),
    "proc.output": (a) => m.procs.output(a.procId),
  };
}
