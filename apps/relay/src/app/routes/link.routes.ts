import {
  linkApproveBodySchema,
  linkApproveResultSchema,
  linkPollBodySchema,
  linkPollResultSchema,
  linkStartResultSchema,
  registerBodySchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, body, failure, signedInAccount, UNAUTHORIZED } from "../http.utils.js";

/**
 * Linking a host, like `gh auth login`: the host starts a link and shows a code, a signed-in user
 * approves it, and the host's signed poll then collects its device token.
 */
export function linkRoutes(app: Hono, deps: TRelayDeps): void {
  app.post(relayRoutes.linkStart.path, async (c) => {
    const b = await body(c, registerBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.startLink(b);
    if (!result.ok) return failure(c, result.error);
    return c.json(linkStartResultSchema.parse(result.value));
  });

  app.post(relayRoutes.linkApprove.path, async (c) => {
    const accountId = await signedInAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    const b = await body(c, linkApproveBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.approveLink(accountId, b.code);
    if (!result.ok) return failure(c, result.error);
    return c.json(linkApproveResultSchema.parse(result.value));
  });

  app.post(relayRoutes.linkPoll.path, async (c) => {
    const b = await body(c, linkPollBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.pollLink(b);
    if (!result.ok) return failure(c, result.error);
    const polled = result.value;
    if (polled.status !== "approved") return c.json(linkPollResultSchema.parse(polled));
    // Moving accounts closes the host's socket; it reconnects and lands on the new hub.
    if (polled.previousAccountId !== null) {
      await deps.hubs.removeMember(polled.previousAccountId, b.deviceId, "moved");
    }
    await deps.hubs.addMember(polled.accountId, { deviceId: b.deviceId, kind: polled.kind });
    return c.json(
      linkPollResultSchema.parse({
        status: "approved",
        deviceToken: polled.deviceToken,
        accountEmail: polled.accountEmail,
      }),
    );
  });
}
