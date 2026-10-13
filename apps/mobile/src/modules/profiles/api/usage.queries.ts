import type { TUsageSnapshot } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

const usageKey = (hostId: string, profileId: string) => ["profileUsage", hostId, profileId] as const;

/** A profile's limit state and today's tokens on its computer. */
export function useProfileUsageQuery(hostId: string, profileId: string): UseQueryResult<TUsageSnapshot> {
  return useQuery({
    queryKey: usageKey(hostId, profileId),
    queryFn: () => daemonCall(hostId, "profile.usage", { profileId }),
  });
}

/** `usage.updated` events replace the cached snapshot. Call once at startup. */
export function startUsageSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    if (e.type === "usage.updated") queryClient.setQueryData(usageKey(hostId, e.profileId), e.usage);
  });
}
