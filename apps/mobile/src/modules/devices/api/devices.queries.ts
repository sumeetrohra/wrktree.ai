import type { TDevice } from "@agentdeck/protocol";
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

const KEY = ["devices"] as const;

export function useDevicesQuery(): UseQueryResult<TDevice[]> {
  return useQuery({ queryKey: KEY, queryFn: () => daemonCall("device.list", {}) });
}

export function useRevokeDeviceMutation(): UseMutationResult<TDevice, Error, string> {
  return useMutation({ mutationFn: (deviceId) => daemonCall("device.revoke", { deviceId }) });
}

/** The device list follows `device.updated` events. Call once at startup. */
export function startDevicesSync(): void {
  onDaemonEvent(({ event: e }) => {
    if (e.type !== "device.updated") return;
    queryClient.setQueryData<TDevice[]>(KEY, (list) =>
      list?.some((d) => d.id === e.device.id)
        ? list.map((d) => (d.id === e.device.id ? e.device : d))
        : list
          ? [e.device, ...list]
          : list,
    );
  });
}
