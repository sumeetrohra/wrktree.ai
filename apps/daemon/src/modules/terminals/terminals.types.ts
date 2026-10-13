import type { TWorktree } from "@agentdeck/protocol";

/** The worktree a terminal opens in (the app provides it from the worktrees module). */
export interface ITerminalSource {
  worktree: (id: string) => TWorktree;
}
