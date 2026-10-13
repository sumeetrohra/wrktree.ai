import type { TSharedConfig } from "@agentdeck/protocol";
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, queryClient } from "@/lib/api";

const sharedKey = (hostId: string) => ["sharedConfig", hostId] as const;

/** The instructions, MCP servers and skills every profile on a computer shares (Phase 4c). */
export function useSharedConfigQuery(hostId: string): UseQueryResult<TSharedConfig> {
  return useQuery({
    queryKey: sharedKey(hostId),
    queryFn: () => daemonCall(hostId, "config.shared.get", {}),
  });
}

export function useSaveInstructionsMutation(hostId: string): UseMutationResult<TSharedConfig, Error, string> {
  return useMutation({
    mutationFn: (instructions: string) => daemonCall(hostId, "config.shared.set", { instructions }),
    onSuccess: (cfg) => {
      queryClient.setQueryData(sharedKey(hostId), cfg);
    },
  });
}
