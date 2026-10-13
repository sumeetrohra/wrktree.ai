import {
  okResultSchema,
  previewOpenBodySchema,
  previewOpenResultSchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import { accountOfToken, previewTokenOf } from "#src/shared/preview-host.utils.js";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, bearerDevice, body, failure, UNAUTHORIZED } from "../http.utils.js";

const FORBIDDEN = { status: 403, error: "forbidden" } as const;
const PREVIEW_OFF = { status: 404, error: "previews are off on this relay" } as const;

/**
 * Phase 3c. Requests to `<token>.<preview domain>` go to the account's preview tunnel before any
 * API route; computers open and close tunnels with their device token.
 */
export function previewRoutes(app: Hono, deps: TRelayDeps): void {
  app.use("*", async (c, next) => {
    const token = previewTokenOf(c.req.header("host"), deps.preview.domains);
    if (token === null) {
      await next();
      return;
    }
    return deps.hubs.previewRequest(accountOfToken(token), token, c.req.raw);
  });

  app.post(relayRoutes.preview.path, async (c) => {
    const device = await bearerDevice(c, deps);
    if (!device) return failure(c, UNAUTHORIZED);
    if (device.kind !== "daemon") return failure(c, FORBIDDEN);
    const b = await body(c, previewOpenBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const members = await deps.directory.listDevices(device.accountId);
    if (!members.some((d) => d.id === b.allowedDeviceId)) return failure(c, FORBIDDEN);
    const opened = await deps.hubs.openPreview(device.accountId, device.id, b);
    const url = deps.preview.urlFor(opened.token, new URL(c.req.url));
    if (url === null) return failure(c, PREVIEW_OFF);
    return c.json(previewOpenResultSchema.parse({ ...opened, url }));
  });

  app.delete(`${relayRoutes.previewClose.path}/:token`, async (c) => {
    const device = await bearerDevice(c, deps);
    if (!device) return failure(c, UNAUTHORIZED);
    await deps.hubs.closePreview(device.accountId, device.id, c.req.param("token"));
    return c.json(okResultSchema.parse({ ok: true }));
  });
}
