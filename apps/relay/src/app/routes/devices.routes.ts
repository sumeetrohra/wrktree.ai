import {
  meResultSchema,
  okResultSchema,
  pushRegisterBodySchema,
  registerBodySchema,
  registerResultSchema,
  relayDevicesResultSchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { Hono } from "hono";

import type { TRelayDeps } from "../app.types.js";
import {
  BAD_REQUEST,
  bearerDevice,
  body,
  caller,
  failure,
  signedInAccount,
  UNAUTHORIZED,
} from "../http.utils.js";

export function deviceRoutes(app: Hono, deps: TRelayDeps): void {
  // A consumer (phone, web) joins the account it signed in to.
  app.post(relayRoutes.register.path, async (c) => {
    const accountId = await signedInAccount(c, deps);
    if (accountId === null) return failure(c, UNAUTHORIZED);
    const b = await body(c, registerBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    const result = await deps.directory.register(b, accountId);
    if (!result.ok) return failure(c, result.error);
    const { previousAccountId, deviceToken, kind } = result.value;
    if (previousAccountId !== null) await deps.hubs.removeMember(previousAccountId, b.deviceId, "moved");
    await deps.hubs.addMember(accountId, { deviceId: b.deviceId, kind });
    return c.json(registerResultSchema.parse({ deviceToken }));
  });

  app.get(relayRoutes.me.path, async (c) => {
    const device = await bearerDevice(c, deps);
    if (!device) return failure(c, UNAUTHORIZED);
    return c.json(meResultSchema.parse({ id: device.id }));
  });

  // The account's devices with their signing keys: what every host trusts.
  app.get(relayRoutes.devices.path, async (c) => {
    const who = await caller(c, deps);
    if (!who) return failure(c, UNAUTHORIZED);
    const [devices, connected] = await Promise.all([
      deps.directory.listDevices(who.accountId),
      deps.hubs.connected(who.accountId),
    ]);
    return c.json(
      relayDevicesResultSchema.parse({
        devices: devices.map((d) => ({
          id: d.id,
          kind: d.kind,
          name: d.name,
          signPub: d.signPub,
          connected: connected.includes(d.id),
          createdAt: d.createdAt,
        })),
      }),
    );
  });

  // Removed by a signed-in user, by a host on the account, or by the device itself (logout).
  app.delete(`${relayRoutes.devices.path}/:id`, async (c) => {
    const deviceId = c.req.param("id");
    const who = await caller(c, deps);
    if (!who) return failure(c, UNAUTHORIZED);
    if (who.device && who.device.kind !== "daemon" && who.device.id !== deviceId) {
      return failure(c, { status: 403, error: "sign in to remove other devices" });
    }
    const result = await deps.directory.removeDevice(who.accountId, deviceId);
    if (!result.ok) return failure(c, result.error);
    await deps.hubs.removeMember(who.accountId, deviceId, "revoked");
    return c.json(okResultSchema.parse({ ok: true }));
  });

  app.post(relayRoutes.pushRegister.path, async (c) => {
    const device = await bearerDevice(c, deps);
    if (!device) return failure(c, UNAUTHORIZED);
    const b = await body(c, pushRegisterBodySchema);
    if (!b) return failure(c, BAD_REQUEST);
    if (!(await deps.hubs.setPushToken(device.accountId, device.id, b.expoPushToken))) {
      return failure(c, { status: 404, error: "device not on its account hub" });
    }
    return c.json(okResultSchema.parse({ ok: true }));
  });
}
