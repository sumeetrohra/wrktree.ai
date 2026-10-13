import { spawnDetached } from "#src/infra/process/index.js";
import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";
import { editorCommand } from "../editor.utils.js";
import { localOnly } from "../local-only.utils.js";

export function editorHandlers(m: TModules): Pick<THandlers, "editor.open"> {
  return {
    /** Local only: it acts on this computer's desktop. */
    "editor.open": async (a, ctx) => {
      localOnly(ctx);
      const wt = m.worktrees.get(a.worktreeId);
      const file = a.path ? m.jailFor(a.worktreeId).resolve(a.path).abs : null;
      await spawnDetached(editorCommand(a.editor, wt.path, file, a.line, process.platform), { cwd: wt.path });
      return {};
    },
  };
}
