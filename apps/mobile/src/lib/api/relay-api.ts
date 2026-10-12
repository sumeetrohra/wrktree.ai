import { signRegistration, type TIdentity } from "@agentdeck/crypto";
import {
  meResultSchema,
  okResultSchema,
  registerResultSchema,
  relayDevicesResultSchema,
  relayErrorSchema,
  relayRoutes,
  type TDeviceKind,
  type TRelayDevice,
} from "@agentdeck/protocol";
import type { z } from "zod";

/** A relay refused a request; `status` is the HTTP status, `reason` the relay's message. */
export class RelayApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`relay ${String(status)}: ${reason}`);
  }
}

async function call<S extends z.ZodType>(
  baseUrl: string,
  route: { method: string; path: string },
  schema: S,
  opts: { body?: unknown; token?: string; path?: string } = {},
): Promise<z.infer<S>> {
  const res = await fetch(new URL(opts.path ?? route.path, baseUrl).toString(), {
    method: route.method,
    headers: {
      "content-type": "application/json",
      ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const json: unknown = await res.json();
  if (!res.ok) throw new RelayApiError(res.status, relayErrorSchema.safeParse(json).data?.error ?? "error");
  return schema.parse(json);
}

/**
 * The relay's HTTP API as the app uses it. Account actions take the sign-in ID token; the rest
 * take this device's token.
 */
export const relayApi = {
  /** Joins the signed-in account; returns this device's token. */
  async register(
    relayUrl: string,
    idToken: string,
    me: TIdentity,
    device: { name: string; kind: TDeviceKind },
    at: number,
  ): Promise<string> {
    const body = { ...signRegistration(me, at), ...device };
    return (await call(relayUrl, relayRoutes.register, registerResultSchema, { body, token: idToken }))
      .deviceToken;
  },

  /** The account's devices (either kind of token). */
  async devices(relayUrl: string, token: string): Promise<TRelayDevice[]> {
    return (await call(relayUrl, relayRoutes.devices, relayDevicesResultSchema, { token })).devices;
  },

  /** Removes a device from the account: any with the ID token, this device itself with its own token. */
  async remove(relayUrl: string, token: string, deviceId: string): Promise<void> {
    await call(relayUrl, { method: "DELETE", path: relayRoutes.devices.path }, okResultSchema, {
      token,
      path: `${relayRoutes.devices.path}/${encodeURIComponent(deviceId)}`,
    });
  },

  /** Resolves while this device may connect; rejects with 401 once it was removed. */
  me: (relayUrl: string, deviceToken: string): Promise<z.infer<typeof meResultSchema>> =>
    call(relayUrl, relayRoutes.me, meResultSchema, { token: deviceToken }),

  registerPush: (
    relayUrl: string,
    deviceToken: string,
    expoPushToken: string,
  ): Promise<z.infer<typeof okResultSchema>> =>
    call(relayUrl, relayRoutes.pushRegister, okResultSchema, { body: { expoPushToken }, token: deviceToken }),
};
