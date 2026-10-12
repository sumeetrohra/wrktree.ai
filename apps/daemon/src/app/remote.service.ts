import { hostname } from "node:os";

import { deviceIdFor, type TIdentity } from "@agentdeck/crypto";
import { AgentdeckError, type TDevice } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";

import type { EventBus } from "#src/infra/bus/index.js";
import { RelayApi, RelayLink } from "#src/infra/relay/index.js";
import type { Router } from "#src/infra/rpc/index.js";
import { RelayTransport } from "#src/infra/transport/index.js";
import type { DevicesService } from "#src/modules/devices/index.js";
import { PairingService } from "#src/modules/pairing/index.js";

export type TRelayStatus = {
  configured: boolean;
  url: string | null;
  connected: boolean;
  deviceId: string | null;
};

/**
 * Everything that reaches beyond this machine: the identity, the relay link, encrypted phone
 * sessions and pairing. Started after the identity is loaded, so handlers reach it through here.
 */
export class Remote {
  private pairingSvc: PairingService | null = null;
  private api: RelayApi | null = null;
  private link: RelayLink | null = null;
  private transport: RelayTransport | null = null;
  private deviceId: string | null = null;

  constructor(
    private readonly relayUrl: string | null,
    private readonly devices: DevicesService,
    private readonly log: ILogger,
  ) {}

  start(identity: TIdentity, bus: EventBus, router: Router): void {
    this.deviceId = deviceIdFor(identity.signPub);
    const url = this.relayUrl;
    const api = url === null ? null : new RelayApi(url, identity, hostname());
    this.api = api;
    this.pairingSvc = new PairingService(
      identity,
      api && url !== null ? { relayUrl: url, createOffer: () => api.createOffer() } : null,
      this.devices,
    );
    if (!api || url === null) return;
    const transport = new RelayTransport(
      identity,
      this.deviceId,
      { send: (text) => this.link?.send(text) ?? false },
      bus,
      router,
      this.devices,
      this.pairingSvc,
      this.log,
    );
    this.transport = transport;
    this.link = new RelayLink({
      url,
      token: () => api.deviceToken(),
      reauth: () => api.register(),
      onText: (text) => {
        transport.onText(text);
      },
      onState: (connected) => {
        this.log.info({ connected }, "relay link");
      },
      log: this.log,
    });
    this.link.start();
  }

  pairing(): PairingService {
    if (!this.pairingSvc) throw new AgentdeckError("BAD_STATE", "The daemon is still starting");
    return this.pairingSvc;
  }

  status(): TRelayStatus {
    return {
      configured: this.relayUrl !== null,
      url: this.relayUrl,
      connected: this.link?.connected ?? false,
      deviceId: this.deviceId,
    };
  }

  /** Revokes locally first (frames are refused at once), then asks the relay to drop the device. */
  async revoke(deviceId: string): Promise<TDevice> {
    const device = this.devices.revoke(deviceId);
    this.transport?.dropPeer(deviceId);
    try {
      await this.api?.revoke(deviceId);
    } catch (e) {
      this.log.warn({ deviceId, err: e instanceof Error ? e.message : "error" }, "relay revoke failed");
    }
    return device;
  }

  stop(): void {
    this.link?.stop();
    this.transport?.close();
  }
}
