import type { TCommandResult } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

export type TAgainst = "base" | "head";

/** What changed in a worktree: against its base branch, or uncommitted only (`head`). */
export function useDiffSummaryQuery(
  hostId: string,
  worktreeId: string,
  against: TAgainst,
): UseQueryResult<TCommandResult<"diff.summary">> {
  return useQuery({
    queryKey: ["diffSummary", hostId, worktreeId, against],
    queryFn: () => daemonCall(hostId, "diff.summary", { worktreeId, against }),
  });
}

/** One file's diff, as a blob id (fetch the text with the code module's blob query). */
export function useFileDiffQuery(
  hostId: string,
  worktreeId: string,
  path: string,
  against: TAgainst,
): UseQueryResult<string> {
  return useQuery({
    queryKey: ["diffFile", hostId, worktreeId, path, against],
    queryFn: async () => (await daemonCall(hostId, "diff.file", { worktreeId, path, against })).blob.blobId,
  });
}
