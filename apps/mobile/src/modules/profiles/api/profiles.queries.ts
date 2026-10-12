import type { TProfile } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

export function useProfilesQuery(hostId: string | null): UseQueryResult<TProfile[]> {
  return useQuery({
    queryKey: ["profiles", hostId],
    queryFn: () => (hostId === null ? Promise.resolve([]) : daemonCall(hostId, "profile.list", {})),
    enabled: hostId !== null,
  });
}
