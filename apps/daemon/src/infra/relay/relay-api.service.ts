import { deviceIdFor, signRegistration, signRevocation, type TIdentity } from "@agentdeck/crypto";
import {
  okResultSchema,
  pairOfferResultSchema,
  registerResultSchema,
  relayRoutes,
} from "@agentdeck/protocol";
import type { z } from "zod";

/** The relay's HTTP API as the daemon uses it. Every reply is zod-validated. */
export class RelayApi {
  private token: string | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly me: TIdentity,
    private readonly name: string,
  ) {}

  private async call<S extends z.ZodType>(
    route: { method: string; path: string },
    schema: S,
    opts: { body?: unknown; token?: string; path?: string } = {},
  ): Promise<z.infer<S>> {
    const res = await fetch(new URL(opts.path ?? route.path, this.baseUrl), {
      method: route.method,
      headers: {
        "content-type": "application/json",
        ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    if (!res.ok) throw new Error(`relay ${route.path} returned ${String(res.status)}`);
    return schema.parse(await res.json());
  }

  /** Registers (or re-registers) this daemon and returns a fresh device token. */
  async register(): Promise<string> {
    const body = { ...signRegistration(this.me, Date.now()), kind: "daemon", name: this.name };
    const { deviceToken } = await this.call(relayRoutes.register, registerResultSchema, { body });
    this.token = deviceToken;
    return deviceToken;
  }

  async deviceToken(): Promise<string> {
    return this.token ?? this.register();
  }

  async createOffer(): Promise<{ pairingId: string; expiresAt: number }> {
    return this.call(relayRoutes.pairOffer, pairOfferResultSchema, { token: await this.deviceToken() });
  }

  /** Tells the relay to drop a revoked device's sockets and push token. */
  async revoke(deviceId: string): Promise<void> {
    const at = Date.now();
    const body = {
      daemonDeviceId: deviceIdFor(this.me.signPub),
      at,
      sig: signRevocation(this.me, deviceId, at),
    };
    await this.call({ method: "DELETE", path: relayRoutes.devices.path }, okResultSchema, {
      token: await this.deviceToken(),
      path: `${relayRoutes.devices.path}/${encodeURIComponent(deviceId)}`,
      body,
    });
  }
}
