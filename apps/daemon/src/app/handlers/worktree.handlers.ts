import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

export function worktreeHandlers(
  m: TModules,
): Pick<
  THandlers,
  "worktree.list" | "worktree.create" | "worktree.archive" | "worktree.restore" | "worktree.delete"
> {
  return {
    "worktree.list": (a) => m.worktrees.list(a.repoId),
    "worktree.create": (a) => m.worktrees.create(a),
    "worktree.archive": (a) => m.worktrees.archive(a.worktreeId),
    "worktree.restore": (a) => m.worktrees.restore(a.worktreeId),
    "worktree.delete": async (a) => {
      await m.worktrees.delete(a.worktreeId);
      return {};
    },
  };
}
