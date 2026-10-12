import type { TCloudChat, TCloudWorktree } from "@/lib/cloud";

import type { TOverview } from "../api/overview.queries";

/** One chat as the Work list shows it, live from a host or from cloud history. */
export type TWorkChat = {
  id: string;
  worktreeId: string;
  title: string | null;
  agent: string;
  profile: string | null;
  model: string | null;
  status: string;
};

export type TWorkWorktree = { id: string; repoId: string; branch: string; title: string; deleted: boolean };

/** A computer's work: live (`live`) when it is online, else what it last wrote to the cloud. */
export type TWorkHost = {
  id: string;
  name: string;
  online: boolean;
  live: boolean;
  repos: { id: string; name: string }[];
  worktrees: TWorkWorktree[];
  chats: TWorkChat[];
  /** Why there is nothing to show (loading, offline without history, an error). */
  note: string | null;
};

/** From a live `workspace.overview`. */
export function fromOverview(host: { id: string; name: string }, o: TOverview): TWorkHost {
  return {
    id: host.id,
    name: host.name,
    online: true,
    live: true,
    repos: o.repos.map((r) => ({ id: r.id, name: r.name })),
    worktrees: o.worktrees
      .filter((w) => w.status !== "archived")
      .map((w) => ({ id: w.id, repoId: w.repoId, branch: w.branch, title: w.title, deleted: false })),
    chats: o.chats.map((c) => ({
      id: c.id,
      worktreeId: c.worktreeId,
      title: c.title,
      agent: c.agent,
      profile: o.profiles.find((p) => p.id === c.profileId)?.name ?? null,
      model: c.model ?? null,
      status: c.status,
    })),
    note: null,
  };
}

/** From cloud history, for a computer that is offline (or no longer on the account). */
export function fromCloud(
  host: { id: string; name: string; online: boolean },
  worktrees: readonly TCloudWorktree[],
  chats: readonly TCloudChat[],
): TWorkHost {
  const mine = worktrees.filter((w) => w.hostId === host.id && w.status !== "archived");
  const repos = new Map(mine.map((w) => [w.repoId, w.repoName]));
  return {
    id: host.id,
    name: host.name,
    online: host.online,
    live: false,
    repos: [...repos].map(([id, name]) => ({ id, name })),
    worktrees: mine.map((w) => ({
      id: w.worktreeId,
      repoId: w.repoId,
      branch: w.branch,
      title: w.title,
      deleted: w.deletedAt !== null && w.deletedAt !== undefined,
    })),
    chats: chats
      .filter((c) => c.hostId === host.id)
      .map((c) => ({
        id: c.chatId,
        worktreeId: c.worktreeId,
        title: c.title,
        agent: c.agent,
        profile: c.profileName ?? null,
        model: c.model ?? null,
        // The host is away, so a chat it left running isn't running now.
        status: host.online ? c.status : c.status === "running" ? "stopped" : c.status,
      })),
    note: null,
  };
}
