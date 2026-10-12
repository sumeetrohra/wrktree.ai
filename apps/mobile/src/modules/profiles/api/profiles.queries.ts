import type { TProfile } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

export function useProfilesQuery(): UseQueryResult<TProfile[]> {
  return useQuery({ queryKey: ["profiles"], queryFn: () => daemonCall("profile.list", {}) });
}
