import type { TPermissionDecision } from "@agentdeck/protocol";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

type TVars = {
  chatId: string;
  requestId: string;
  decision: TPermissionDecision;
  message?: string | undefined;
};

/** Answers a permission request on `hostId`. Queued and sent on reconnect if the host is away. */
export function useRespondPermissionMutation(
  hostId: string,
): UseMutationResult<Record<string, never>, Error, TVars> {
  return useMutation({
    mutationFn: ({ message, ...v }) =>
      daemonCall(hostId, "permission.respond", { ...v, ...(message === undefined ? {} : { message }) }),
  });
}
