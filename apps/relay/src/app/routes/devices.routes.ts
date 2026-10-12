import {
  okResultSchema,
  pushRegisterBodySchema,
  registerBodySchema,
  registerResultSchema,
  relayDevicesResultSchema,
  relayRoutes,
  revokeBodySchema,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";
import { BAD_REQUEST, bearer, body, failure, sessionAccount, UNAUTHORIZED } from "../http.utils.js";

export function deviceRoutes(app: Hono, deps: TRelayDeps): void {
  app.post(relayRoutes.register.path, async (c) => {
    const b = await body(c, registerBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    // A phone or web client registers with an account session; a daemon registers without one.
    const accountId = bearer(c) === null ? null : await sessionAccount(c, deps);
    if (bearer(c) !== null && accountId === null) return failure(c, UNAUTHORIZED);
    const result = await deps.directory.register(b, accountId);
    if (!result.ok) return failure(c, result.error);
    const { previousAccountId, accountId: target, deviceToken } = result.value;
    if (previousAccountId !== null) await deps.hubs.removeMember(previousAccountId, b.deviceId, "moved");
    await deps.hubs.addMember(target, { deviceId: b.deviceId, kind: b.kind });
    return c.json(registerResultSchema.parse({ deviceToken }));
  });

  app.get(relayRoutes.devices.path, async (c) => {
    const accountId = await sessionAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    const [devices, connected] = await Promise.all([
      deps.directory.listDevices(accountId),
      deps.hubs.connected(accountId),
    ]);
    return c.json(
      relayDevicesResultSchema.parse({
        devices: devices
          .filter((d) => d.revokedAt === null)
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            name: d.name,
            connected: connected.includes(d.id),
            createdAt: d.createdAt,
          })),
      }),
    );
  });

  // Revoke with an account session (phone, web) or a daemon's device token; either way the body
  // must carry a daemon's signature over the revoked id.
  app.delete(`${relayRoutes.devices.path}/:id`, async (c) => {
    const token = bearer(c);
    const daemon = token === null ? null : await deps.directory.deviceByToken(token);
    const accountId =
      daemon?.kind === "daemon" && daemon.revokedAt === null
        ? daemon.accountId
        : await sessionAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    const b = await body(c, revokeBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const deviceId = c.req.param("id");
    const result = await deps.directory.revoke(accountId, deviceId, b);
    if (!result.ok) return failure(c, result.error);
    await deps.hubs.removeMember(accountId, deviceId, "revoked");
    return c.json(okResultSchema.parse({ ok: true }));
  });

  app.post(relayRoutes.pushRegister.path, async (c) => {
    const token = bearer(c);
    const device = token === null ? null : await deps.directory.deviceByToken(token);
    if (device?.revokedAt !== null) return failure(c, UNAUTHORIZED);
    const b = await body(c, pushRegisterBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    if (!(await deps.hubs.setPushToken(device.accountId, device.id, b.expoPushToken))) {
      return failure(c, { status: 404, error: "device not on its account hub" });
    }
    return c.json(okResultSchema.parse({ ok: true }));
  });
}
