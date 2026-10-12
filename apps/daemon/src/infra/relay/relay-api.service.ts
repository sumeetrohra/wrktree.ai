import { signRegistration, type TIdentity } from "@agentdeck/crypto";
import {
  devIdTokenResultSchema,
  meResultSchema,
  okResultSchema,
  registerResultSchema,
  relayConfigSchema,
  relayDevicesResultSchema,
  relayRoutes,
  type TRelayConfig,
  type TRelayDevice,
} from "@agentdeck/protocol";
import type { z } from "zod";

/** The relay answered with an HTTP error. `status` 401 means the device token is no good. */
export class RelayHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`relay ${path} returned ${String(status)}`);
  }
}

/** The relay's HTTP API as the daemon uses it. Every reply is zod-validated. */
export class RelayApi {
  constructor(
    readonly baseUrl: string,
    private readonly identity: TIdentity,
    private readonly name: string,
  ) {}

  private async call<S extends z.ZodType>(
    route: { method: string; path: string },
    schema: S,
    opts: { body?: unknown; token?: string; path?: string } = {},
  ): Promise<z.infer<S>> {
    const path = opts.path ?? route.path;
    const res = await fetch(new URL(path, this.baseUrl), {
      method: route.method,
      headers: {
        "content-type": "application/json",
        ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    if (!res.ok) throw new RelayHttpError(path, res.status);
    return schema.parse(await res.json());
  }

  /** The relay's public client configuration (Firebase project, or dev sign-in only). */
  config(): Promise<TRelayConfig> {
    return this.call(relayRoutes.config, relayConfigSchema);
  }

  /** Joins the account the ID token belongs to, as a host. Returns this host's device token. */
  async register(idToken: string): Promise<string> {
    const body = { ...signRegistration(this.identity, Date.now()), kind: "daemon", name: this.name };
    return (await this.call(relayRoutes.register, registerResultSchema, { body, token: idToken }))
      .deviceToken;
  }

  /** Dev relays only: an ID token for `uid` from the relay's own issuer. */
  async devIdToken(uid: string): Promise<string> {
    const q = `uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(`${uid}@example.com`)}`;
    return (
      await this.call(relayRoutes.devIdToken, devIdTokenResultSchema, {
        path: `${relayRoutes.devIdToken.path}?${q}`,
      })
    ).idToken;
  }

  /** The account's devices and their signing keys: who may open a session with this host. */
  async devices(token: string): Promise<TRelayDevice[]> {
    return (await this.call(relayRoutes.devices, relayDevicesResultSchema, { token })).devices;
  }

  /** Resolves while the token is good; throws `RelayHttpError` 401 once this host was removed. */
  async me(token: string): Promise<void> {
    await this.call(relayRoutes.me, meResultSchema, { token });
  }

  /** Removes a device from the account (this host's own id to unlink itself). */
  async removeDevice(token: string, deviceId: string): Promise<void> {
    await this.call({ method: "DELETE", path: relayRoutes.devices.path }, okResultSchema, {
      token,
      path: `${relayRoutes.devices.path}/${encodeURIComponent(deviceId)}`,
    });
  }
}
