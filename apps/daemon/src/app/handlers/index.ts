import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

import { blobHandlers } from "./blob.handlers.js";
import { chatHandlers } from "./chat.handlers.js";
import { configHandlers } from "./config.handlers.js";
import { deviceHandlers } from "./device.handlers.js";
import { editorHandlers } from "./editor.handlers.js";
import { filesHandlers } from "./files.handlers.js";
import { gitHandlers } from "./git.handlers.js";
import { handoffHandlers } from "./handoff.handlers.js";
import { prHandlers } from "./pr.handlers.js";
import { previewHandlers } from "./preview.handlers.js";
import { procHandlers } from "./proc.handlers.js";
import { profileHandlers } from "./profile.handlers.js";
import { repoHandlers } from "./repo.handlers.js";
import { syncHandlers } from "./sync.handlers.js";
import { termHandlers } from "./term.handlers.js";
import { workspaceHandlers } from "./workspace.handlers.js";
import { worktreeHandlers } from "./worktree.handlers.js";

/** Every command's handler. `THandlers` is total, so a missing one fails `tsc`. */
export function createHandlers(m: TModules): THandlers {
  return {
    ...syncHandlers(m),
    ...repoHandlers(m),
    ...profileHandlers(m),
    ...worktreeHandlers(m),
    ...chatHandlers(m),
    ...filesHandlers(m),
    ...blobHandlers(m),
    ...deviceHandlers(m),
    ...workspaceHandlers(m),
    ...gitHandlers(m),
    ...prHandlers(m),
    ...procHandlers(m),
    ...handoffHandlers(m),
    ...configHandlers(m),
    ...previewHandlers(m),
    ...editorHandlers(m),
    ...termHandlers(m),
  };
}
