import type { TChat, TCommandArgs, TCompare, TDiffFile } from "@agentdeck/protocol";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

const compareKey = (hostId: string, id: string) => ["compare", hostId, id] as const;
const comparesKey = (hostId: string, repoId: string) => ["compares", hostId, repoId] as const;
/** How often an open compare refreshes its entries' chats and changes. */
const REFRESH_MS = 3000;

export function useCompareQuery(hostId: string, compareId: string): UseQueryResult<TCompare> {
  return useQuery({
    queryKey: compareKey(hostId, compareId),
    queryFn: () => daemonCall(hostId, "compare.get", { compareId }),
  });
}

/** A repo's compares, newest first. */
export function useComparesQuery(hostId: string, repoId: string): UseQueryResult<TCompare[]> {
  return useQuery({
    queryKey: comparesKey(hostId, repoId),
    queryFn: async () => (await daemonCall(hostId, "compare.list", { repoId })).reverse(),
  });
}

export type TCompareEntryState = { chat: TChat | undefined; files: readonly TDiffFile[] | undefined };

/** Each entry's chat and changed files, refreshed while the compare is open. */
export function useCompareEntries(hostId: string, compare: TCompare | undefined): TCompareEntryState[] {
  const entries = compare?.entries ?? [];
  const chats = useQueries({
    queries: entries.map((e) => ({
      queryKey: ["compare-chat", hostId, e.worktreeId] as const,
      queryFn: () => daemonCall(hostId, "chat.list", { worktreeId: e.worktreeId }),
      refetchInterval: REFRESH_MS,
    })),
  });
  const diffs = useQueries({
    queries: entries.map((e) => ({
      queryKey: ["compare-diff", hostId, e.worktreeId] as const,
      queryFn: () => daemonCall(hostId, "diff.summary", { worktreeId: e.worktreeId }),
      refetchInterval: REFRESH_MS,
    })),
  });
  return entries.map((e, i) => ({
    chat: chats[i]?.data?.find((c) => c.id === e.chatId),
    files: diffs[i]?.data?.files,
  }));
}

export async function startCompare(hostId: string, args: TCommandArgs<"compare.start">): Promise<TCompare> {
  const compare = await daemonCall(hostId, "compare.start", args);
  store(hostId, compare);
  return compare;
}

export async function pickCompare(hostId: string, compareId: string, worktreeId: string): Promise<void> {
  store(hostId, await daemonCall(hostId, "compare.pick", { compareId, worktreeId }));
}

function store(hostId: string, compare: TCompare): void {
  queryClient.setQueryData(compareKey(hostId, compare.id), compare);
  queryClient.setQueryData<TCompare[]>(comparesKey(hostId, compare.repoId), (list) =>
    list
      ? list.some((c) => c.id === compare.id)
        ? list.map((c) => (c.id === compare.id ? compare : c))
        : [compare, ...list]
      : list,
  );
}

/** `compare.updated` keeps open compares and the lists current. Call once at startup. */
export function startCompareSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    if (e.type === "compare.updated") store(hostId, e.compare);
  });
}
