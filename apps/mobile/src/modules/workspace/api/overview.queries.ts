import type { TCommandResult } from "@agentdeck/protocol";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

export type TOverview = TCommandResult<"workspace.overview">;

const keys = {
  all: ["overview"] as const,
  host: (hostId: string) => ["overview", hostId] as const,
};

/** Each host's repos, branches, chats and profiles, one query per host. */
export function useOverviewQueries(hostIds: readonly string[]): UseQueryResult<TOverview>[] {
  return useQueries({
    queries: hostIds.map((hostId) => ({
      queryKey: keys.host(hostId),
      queryFn: () => daemonCall(hostId, "workspace.overview", {}),
      retry: 1,
    })),
  });
}

/**
 * Overviews follow worktree and chat-status events: statuses are patched in place, anything
 * structural refetches that host's overview. Call once at startup.
 */
export function startOverviewSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    const key = keys.host(hostId);
    if (e.type === "chat.status") {
      const o = queryClient.getQueryData<TOverview>(key);
      if (o?.chats.some((c) => c.id === e.chatId)) {
        queryClient.setQueryData<TOverview>(key, {
          ...o,
          chats: o.chats.map((c) => (c.id === e.chatId ? { ...c, status: e.status } : c)),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
    if (e.type === "worktree.updated" || e.type === "worktree.removed") {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });
}
