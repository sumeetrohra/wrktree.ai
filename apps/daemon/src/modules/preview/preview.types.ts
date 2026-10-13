import type { TPreviewOpenResult, TProc, TWorktree } from "@agentdeck/protocol";

/** What Preview needs from the rest of the daemon (the app wires worktrees, repos, procs, relay). */
export interface IPreviewDeps {
  worktree(id: string): TWorktree;
  /** The repo's `preview` config, or undefined when the repo has none. */
  config(wt: TWorktree): { script: string; env: Readonly<Record<string, string>> } | undefined;
  procs: {
    start(worktreeId: string, script: string, env: Readonly<Record<string, string>>): TProc;
    running(worktreeId: string, script: string): TProc | null;
    proc(procId: string): TProc;
    stop(procId: string): Promise<TProc>;
  };
  /** The relay's tunnel endpoints (the account link). */
  tunnel: {
    open(worktreeId: string, deviceId: string): Promise<TPreviewOpenResult>;
    close(token: string): Promise<void>;
  };
  /** Resolves true once the port accepts connections, false on timeout or when `gaveUp`. */
  waitForPort(port: number, ms: number, gaveUp: () => boolean): Promise<boolean>;
}
