import type { TWorktree } from "@agentdeck/protocol";

/** Worktrees and their repo's scripts (the app provides it from the worktrees and repos modules). */
export interface IProcSource {
  worktree: (id: string) => TWorktree;
  config: (wt: TWorktree) => {
    scripts: Readonly<Record<string, string>>;
    env: Readonly<Record<string, string>>;
  };
}
