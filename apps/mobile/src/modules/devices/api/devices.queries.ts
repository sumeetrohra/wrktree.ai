import type { TRelayDevice } from "@agentdeck/protocol";
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import { accountDevices, accountRelayUrl, queryClient, refreshHosts, relayApi } from "@/lib/api";
import { auth } from "@/lib/auth";

const KEY = ["account-devices"] as const;

/** Every device on the account (computers, phones, browsers), from the relay. */
export function useAccountDevicesQuery(): UseQueryResult<TRelayDevice[]> {
  return useQuery({ queryKey: KEY, queryFn: accountDevices, refetchInterval: 30_000 });
}

/** Removes a device from the account (needs the signed-in user, not just this device). */
export function useRemoveDeviceMutation(): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: async (deviceId) => {
      const relayUrl = accountRelayUrl();
      if (relayUrl === null) throw new Error("Not signed in");
      await relayApi.remove(relayUrl, await auth.idToken(), deviceId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      await refreshHosts();
    },
  });
}
