import type { TRepo } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

import { reposKeys } from "./repos.keys";

/** Repositories one host knows about (A3). */
export function useReposQuery(hostId: string): UseQueryResult<TRepo[]> {
  return useQuery({ queryKey: reposKeys.list(hostId), queryFn: () => daemonCall(hostId, "repo.list", {}) });
}
