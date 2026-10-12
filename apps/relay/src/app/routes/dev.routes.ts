import { devIdTokenResultSchema, devPushesResultSchema, relayRoutes } from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { DevIdTokens } from "#src/infra/idtoken/index.js";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, failure } from "../http.utils.js";

/** Test and local-development endpoints. Never mounted unless RELAY_DEV=1. */
export function devRoutes(app: Hono, deps: TRelayDeps, issuer: DevIdTokens): void {
  // Stands in for signing in with Firebase.
  app.get(relayRoutes.devIdToken.path, async (c) => {
    const uid = c.req.query("uid");
    if (uid === undefined || !/^[\w.@+-]{1,128}$/.test(uid)) return failure(c, BAD_REQUEST);
    const email = c.req.query("email") ?? null;
    const idToken = await issuer.issue({ uid, email }, deps.clock.now());
    return c.json(devIdTokenResultSchema.parse({ idToken }));
  });
  app.get(relayRoutes.devPushes.path, async (c) =>
    c.json(devPushesResultSchema.parse({ pushes: await deps.directory.pushes() })),
  );
}
