import type { TWorktree } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { worktreesKeys } from "./worktrees.keys";

export function useWorktreesQuery(hostId: string, repoId: string): UseQueryResult<TWorktree[]> {
  return useQuery({
    queryKey: worktreesKeys.list(hostId, repoId),
    queryFn: () => daemonCall(hostId, "worktree.list", { repoId }),
  });
}

/** Lists follow `worktree.updated` / `worktree.removed` events, without refetching. Call once at startup. */
export function startWorktreesSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    if (e.type === "worktree.updated") {
      queryClient.setQueryData<TWorktree[]>(worktreesKeys.list(hostId, e.worktree.repoId), (list) => {
        if (!list) return list;
        return list.some((w) => w.id === e.worktree.id)
          ? list.map((w) => (w.id === e.worktree.id ? e.worktree : w))
          : [...list, e.worktree];
      });
    }
    if (e.type === "worktree.removed") {
      for (const [key, list] of queryClient.getQueriesData<TWorktree[]>({
        queryKey: worktreesKeys.host(hostId),
      })) {
        if (list?.some((w) => w.id === e.worktreeId)) {
          queryClient.setQueryData(
            key,
            list.filter((w) => w.id !== e.worktreeId),
          );
        }
      }
    }
  });
}

/**
 * Creates a worktree on `hostId` and resolves once its setup finished (status `ready`), or rejects
 * if setup failed. Readiness arrives as an event, so this listens instead of polling.
 */
export async function createReadyWorktree(
  hostId: string,
  v: { repoId: string; branch: string; title: string },
): Promise<TWorktree> {
  let stop: () => void = () => undefined;
  const ready = new Promise<TWorktree>((resolve, reject) => {
    let id: string | null = null;
    const seen: TWorktree[] = [];
    const check = (w: TWorktree): void => {
      if (w.status === "ready") resolve(w);
      if (w.status === "setup_failed") reject(new Error(w.setupError ?? "Setup failed"));
    };
    stop = onDaemonEvent((from, { event: e }) => {
      if (from !== hostId || e.type !== "worktree.updated") return;
      if (id === null) seen.push(e.worktree);
      else if (e.worktree.id === id) check(e.worktree);
    });
    void daemonCall(hostId, "worktree.create", v).then(
      (wt) => {
        id = wt.id;
        check(wt);
        for (const w of seen) if (w.id === wt.id) check(w);
      },
      (err: unknown) => {
        reject(err instanceof Error ? err : new Error("worktree.create failed"));
      },
    );
  });
  try {
    return await ready;
  } finally {
    stop();
  }
}
