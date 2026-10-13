import { AgentdeckError } from "@agentdeck/protocol";

import type { THandlers } from "#src/infra/rpc/index.js";

import type { TModules } from "../app.types.js";

const BUSY = new Set(["running", "awaiting_permission"]);

/** Writes to a worktree's branch wait until no agent is mid-turn in it. */
export function assertAgentsQuiet(m: TModules, worktreeId: string): void {
  if (m.sessions.list(worktreeId).some((c) => BUSY.has(c.status))) {
    throw new AgentdeckError(
      "BAD_STATE",
      "An agent is still working in this worktree; wait for it to finish",
      true,
    );
  }
}

export function gitHandlers(
  m: TModules,
): Pick<THandlers, "git.status" | "git.commit" | "git.push" | "worktree.mergeToBase"> {
  return {
    "git.status": (a) => m.git.status(m.worktrees.get(a.worktreeId)),
    "git.commit": (a) => {
      assertAgentsQuiet(m, a.worktreeId);
      return m.git.commit(m.worktrees.get(a.worktreeId), a.message, a.all);
    },
    "git.push": (a) => {
      assertAgentsQuiet(m, a.worktreeId);
      return m.git.push(m.worktrees.get(a.worktreeId));
    },
    "worktree.mergeToBase": (a) => {
      assertAgentsQuiet(m, a.worktreeId);
      const wt = m.worktrees.get(a.worktreeId);
      return m.git.mergeToBase(wt, m.repos.get(wt.repoId).path);
    },
  };
}
