import { devOutboxResultSchema, devPushesResultSchema, relayRoutes } from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";

/** Inspection endpoints for tests and local development. Never mounted unless RELAY_DEV=1. */
export function devRoutes(app: Hono, deps: TRelayDeps): void {
  app.get(relayRoutes.devOutbox.path, async (c) =>
    c.json(devOutboxResultSchema.parse({ messages: await deps.directory.outbox() })),
  );
  app.get(relayRoutes.devPushes.path, async (c) =>
    c.json(devPushesResultSchema.parse({ pushes: await deps.directory.pushes() })),
  );
  app.get(relayRoutes.devGithub.path, (c) =>
    c.text("Dev OAuth: finish with code dev-<login> and this state."),
  );
}
