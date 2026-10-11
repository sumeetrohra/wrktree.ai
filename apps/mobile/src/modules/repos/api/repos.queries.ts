import type { TRepo } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

import { reposKeys } from "./repos.keys";

/** Repositories the daemon knows about (A3). */
export function useReposQuery(): UseQueryResult<TRepo[]> {
  return useQuery({ queryKey: reposKeys.list(), queryFn: () => daemonCall()("repo.list", {}) });
}
