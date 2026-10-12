import { relayRoutes } from "@agentdeck/protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";

import type { TRelayDeps } from "./app.types.js";
import { authRoutes } from "./routes/auth.routes.js";
import { devRoutes } from "./routes/dev.routes.js";
import { deviceRoutes } from "./routes/devices.routes.js";
import { pairRoutes } from "./routes/pair.routes.js";

/** The relay's HTTP API, identical on both hosts. WebSocket upgrades are handled by the host. */
export function createRelayApp(deps: TRelayDeps): Hono {
  const app = new Hono();
  // The web app calls the relay cross-origin. Auth is a bearer header, never a cookie, so any
  // origin may call; a page without a token gets nothing.
  app.use("/v1/*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"], maxAge: 600 }));
  app.get(relayRoutes.health.path, (c) => c.json({ ok: true }));
  authRoutes(app, deps);
  deviceRoutes(app, deps);
  pairRoutes(app, deps);
  if (deps.dev) devRoutes(app, deps);
  app.onError((e, c) => {
    deps.log.error({ err: e.message, path: c.req.path }, "relay request failed");
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}

/** Resolves a WebSocket upgrade's device token. Null means 401. */
export async function authenticateSocket(
  deps: Pick<TRelayDeps, "directory">,
  token: string | null,
  deviceParam: string | null,
): Promise<{ deviceId: string; accountId: string } | null> {
  if (token === null) return null;
  const device = await deps.directory.deviceByToken(token);
  if (device?.revokedAt !== null) return null;
  if (deviceParam !== null && deviceParam !== device.id) return null;
  return { deviceId: device.id, accountId: device.accountId };
}
