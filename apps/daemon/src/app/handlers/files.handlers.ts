import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function filesHandlers(
  m: TModules,
): Pick<THandlers, "diff.summary" | "diff.file" | "fs.tree" | "fs.read" | "fs.search"> {
  return {
    "diff.summary": (a) => m.git.summary(m.worktrees.get(a.worktreeId), m.jailFor(a.worktreeId), a.against),
    "diff.file": async (a) => ({
      blob: await m.git.fileDiff(m.worktrees.get(a.worktreeId), m.jailFor(a.worktreeId), a.path, a.against),
    }),
    "fs.tree": (a) => ({ entries: m.jailFor(a.worktreeId).tree(a.path) }),
    "fs.read": (a) => m.jailFor(a.worktreeId).read(a.path, a.offset, a.length),
    "fs.search": (a) => m.jailFor(a.worktreeId).search(a.query),
  };
}
