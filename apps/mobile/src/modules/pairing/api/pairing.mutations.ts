import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { connectMachine, connStorage, pairWith, relayApi, type TPairingOffer } from "@/lib/api";
import { deviceName } from "@/lib/device";
import { registerForPush } from "@/lib/notifications";

import { usePairingStore } from "../stores/pairing.store";

/**
 * Claims the offer, proves this phone saw the QR code, checks the daemon's signature, then starts
 * the encrypted connection (it opens once the desktop confirms the code) and registers for push.
 */
export function usePairMutation(): UseMutationResult<
  string,
  Error,
  { offer: TPairingOffer; session: string; deviceToken: string }
> {
  return useMutation({
    mutationFn: async ({ offer, session, deviceToken }) => {
      const code = await pairWith(offer, connStorage.identity(), session, deviceToken, deviceName());
      usePairingStore.getState().setCode(code);
      // The computer's name as it registered with the relay (its hostname).
      const devices = await relayApi.devices(offer.relayUrl, session).catch(() => []);
      const name = devices.find((d) => d.id === offer.daemonDeviceId)?.name ?? "Computer";
      connectMachine(
        {
          relayUrl: offer.relayUrl,
          daemonDeviceId: offer.daemonDeviceId,
          daemonSignPub: offer.daemonSignPub,
          name,
        },
        deviceToken,
      );
      const pushToken = await registerForPush();
      if (pushToken !== null)
        await relayApi.registerPush(offer.relayUrl, deviceToken, pushToken).catch(() => undefined);
      return code;
    },
  });
}
