import { signRegistration, type TIdentity } from "@agentdeck/crypto";
import {
  authSessionSchema,
  meResultSchema,
  okResultSchema,
  pairClaimResultSchema,
  registerResultSchema,
  relayDevicesResultSchema,
  relayErrorSchema,
  relayRoutes,
  type TAuthSession,
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

/** The relay's HTTP API as the app uses it (sign-in, devices, pairing, push). */
export const relayApi = {
  startSignIn: (relayUrl: string, email: string): Promise<z.infer<typeof okResultSchema>> =>
    call(relayUrl, relayRoutes.authStart, okResultSchema, { body: { email } }),

  finishSignIn: (relayUrl: string, email: string, code: string): Promise<TAuthSession> =>
    call(relayUrl, relayRoutes.authFinish, authSessionSchema, { body: { email, code } }),

  async register(
    relayUrl: string,
    session: string,
    me: TIdentity,
    name: string,
    at: number,
  ): Promise<string> {
    const body = { ...signRegistration(me, at), kind: "phone", name };
    return (await call(relayUrl, relayRoutes.register, registerResultSchema, { body, token: session }))
      .deviceToken;
  },

  claim: (
    relayUrl: string,
    session: string,
    pairingId: string,
    phoneDeviceId: string,
  ): Promise<z.infer<typeof pairClaimResultSchema>> =>
    call(relayUrl, relayRoutes.pairClaim, pairClaimResultSchema, {
      body: { pairingId, phoneDeviceId },
      token: session,
    }),

  async devices(relayUrl: string, session: string): Promise<TRelayDevice[]> {
    return (await call(relayUrl, relayRoutes.devices, relayDevicesResultSchema, { token: session })).devices;
  },

  /** Resolves while this device may connect; rejects with 401 once it was revoked. */
  me: (relayUrl: string, deviceToken: string): Promise<z.infer<typeof meResultSchema>> =>
    call(relayUrl, relayRoutes.me, meResultSchema, { token: deviceToken }),

  registerPush: (
    relayUrl: string,
    deviceToken: string,
    expoPushToken: string,
  ): Promise<z.infer<typeof okResultSchema>> =>
    call(relayUrl, relayRoutes.pushRegister, okResultSchema, { body: { expoPushToken }, token: deviceToken }),
};
