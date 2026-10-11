import type { TRepo } from "@agentdeck/protocol";

/** The parts of `.agentdeck/config.json` worktrees act on. */
export type TWorktreeScripts = {
  setup: readonly string[];
  teardown: readonly string[];
  env: Readonly<Record<string, string>>;
};

/** Repositories and their config (the repos module provides it). */
export interface IRepoSource {
  get: (id: string) => TRepo;
  config: (repo: TRepo) => TWorktreeScripts;
}

/** Chats react to worktree lifecycle changes through these hooks (the sessions module provides them). */
export interface IWorktreeHooks {
  stopChats: (worktreeId: string) => void;
  startChats: (worktreeId: string) => void;
  deleteChats: (worktreeId: string) => void;
}
