import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { connStorage, relayApi } from "@/lib/api";
import { deviceName } from "@/lib/device";
import { nowMs } from "@/shared/utils/datetime-utils";

/** Step 1: the relay emails a six-digit code. */
export function useStartSignInMutation(): UseMutationResult<
  unknown,
  Error,
  { relayUrl: string; email: string }
> {
  return useMutation({ mutationFn: ({ relayUrl, email }) => relayApi.startSignIn(relayUrl, email) });
}

/**
 * Step 2: trade the code for an account session, then register this phone on the account
 * (its device id is derived from its own signing key). Both secrets go to the keychain.
 */
export function useFinishSignInMutation(): UseMutationResult<
  { session: string; deviceToken: string },
  Error,
  { relayUrl: string; email: string; code: string }
> {
  return useMutation({
    mutationFn: async ({ relayUrl, email, code }) => {
      const { sessionToken } = await relayApi.finishSignIn(relayUrl, email, code);
      const deviceToken = await relayApi.register(
        relayUrl,
        sessionToken,
        connStorage.identity(),
        deviceName(),
        nowMs(),
      );
      connStorage.setSession(sessionToken);
      connStorage.setEmail(email);
      return { session: sessionToken, deviceToken };
    },
  });
}
