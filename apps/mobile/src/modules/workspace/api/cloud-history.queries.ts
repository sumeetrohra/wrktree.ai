import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { cloud, type TCloudChat, type TCloudHost, type TCloudWorktree } from "@/lib/cloud";

export type TCloudHistory = { hosts: TCloudHost[]; worktrees: TCloudWorktree[]; chats: TCloudChat[] };

/** Every host's worktrees and chats as stored in the cloud (refreshed every 30 s). */
export function useCloudHistoryQuery(): UseQueryResult<TCloudHistory> {
  return useQuery({
    queryKey: ["cloud-history"],
    queryFn: async () => {
      const [hosts, worktrees, chats] = await Promise.all([cloud.hosts(), cloud.worktrees(), cloud.chats()]);
      return { hosts, worktrees, chats };
    },
    enabled: cloud.available(),
    refetchInterval: 30_000,
  });
}
