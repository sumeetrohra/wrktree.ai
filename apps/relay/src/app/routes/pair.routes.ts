import {
  pairClaimBodySchema,
  pairClaimResultSchema,
  pairOfferResultSchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, bearer, body, failure, sessionAccount, UNAUTHORIZED } from "../http.utils.js";

export function pairRoutes(app: Hono, deps: TRelayDeps): void {
  app.post(relayRoutes.pairOffer.path, async (c) => {
    const token = bearer(c);
    const device = token === null ? null : await deps.directory.deviceByToken(token);
    if (device?.kind !== "daemon" || device.revokedAt !== null) return failure(c, UNAUTHORIZED);
    return c.json(pairOfferResultSchema.parse(await deps.directory.createPairing(device.id)));
  });

  app.post(relayRoutes.pairClaim.path, async (c) => {
    const accountId = await sessionAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    const b = await body(c, pairClaimBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.claimPairing(accountId, b.pairingId, b.phoneDeviceId);
    if (!result.ok) return failure(c, result.error);
    const { daemonDeviceId, previousAccountId } = result.value;
    if (previousAccountId !== accountId) {
      // Moving accounts closes the daemon's socket; it reconnects and lands on the new hub.
      await deps.hubs.addMember(accountId, { deviceId: daemonDeviceId, kind: "daemon" });
      await deps.hubs.removeMember(previousAccountId, daemonDeviceId, "moved");
    }
    return c.json(pairClaimResultSchema.parse({ daemonDeviceId }));
  });
}
