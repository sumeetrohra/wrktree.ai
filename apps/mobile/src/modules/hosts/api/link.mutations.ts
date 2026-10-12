import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { accountRelayUrl, refreshHosts, relayApi } from "@/lib/api";
import { auth } from "@/lib/auth";

/** Approves a computer's `agentdeck login` code: it joins the account and shows up as a host. */
export function useApproveLinkMutation(): UseMutationResult<
  { deviceId: string; name: string },
  Error,
  string
> {
  return useMutation({
    mutationFn: async (code) => {
      const relayUrl = accountRelayUrl();
      if (relayUrl === null) throw new Error("Sign in first");
      return relayApi.approveLink(relayUrl, await auth.idToken(), code);
    },
    onSuccess: () => {
      // The computer collects its token within a couple of seconds; then it is on the list.
      setTimeout(() => {
        void refreshHosts();
      }, 2500);
    },
  });
}
