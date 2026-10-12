import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { joinAccount, leaveAccount, registerPushToken } from "@/lib/api";
import { auth, type TAuthUser } from "@/lib/auth";
import { deviceName } from "@/lib/device";
import { registerForPush } from "@/lib/notifications";
import { nowMs } from "@/shared/utils/datetime-utils";

/** After any sign-in: join the account on the relay, then register for push. */
async function join(relayUrl: string): Promise<void> {
  const url = relayUrl.replace(/\/$/, "");
  await joinAccount(url, await auth.idToken(), deviceName(), nowMs());
  const pushToken = await registerForPush();
  if (pushToken !== null) await registerPushToken(pushToken).catch(() => undefined);
}

/** Step 1 of email sign-in: Firebase emails a link. */
export function useSendLinkMutation(): UseMutationResult<void, Error, { relayUrl: string; email: string }> {
  return useMutation({ mutationFn: ({ relayUrl, email }) => auth.sendEmailLink(relayUrl, email) });
}

/** Step 2: the link from the email (opened on this device, or pasted). */
export function useCompleteSignInMutation(): UseMutationResult<
  TAuthUser,
  Error,
  { relayUrl: string; email: string; link: string }
> {
  return useMutation({
    mutationFn: async ({ relayUrl, email, link }) => {
      const user = await auth.completeEmailLink(relayUrl, email, link);
      await join(relayUrl);
      return user;
    },
  });
}

/** Development builds: sign in as any user id through the relay's dev issuer. */
export function useDevSignInMutation(): UseMutationResult<
  TAuthUser,
  Error,
  { relayUrl: string; uid: string }
> {
  return useMutation({
    mutationFn: async ({ relayUrl, uid }) => {
      const user = await auth.signInDev(relayUrl.replace(/\/$/, ""), uid);
      await join(relayUrl);
      return user;
    },
  });
}

/** Leaves the account on this device. */
export function useSignOutMutation(): UseMutationResult<void, Error, void> {
  return useMutation({
    mutationFn: async () => {
      await leaveAccount();
      auth.signOut();
    },
  });
}
