import { deviceIdFor, type TIdentity } from "@agentdeck/crypto";
import { AgentdeckError, type TAccountStatus, type TDevice } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";
import { z } from "zod";

import type { EventBus } from "#src/infra/bus/index.js";
import { SealedFile, type TVault } from "#src/infra/keystore/index.js";
import { RelayApi, RelayHttpError, RelayLink } from "#src/infra/relay/index.js";
import type { Router } from "#src/infra/rpc/index.js";
import { RelayTransport, type IRelayPeers } from "#src/infra/transport/index.js";
import type { DevicesService } from "#src/modules/devices/index.js";

export type TRelayStatus = {
  configured: boolean;
  url: string | null;
  connected: boolean;
  deviceId: string | null;
};

const linkedSchema = z.object({
  relayUrl: z.string(),
  deviceToken: z.string(),
  email: z.string().nullable(),
});
type TLinked = z.infer<typeof linkedSchema>;
type TLinking = { linkId: string; code: string; url: string; expiresAt: number; timer: NodeJS.Timeout };

const LINK_POLL_MS = 1500;
const REFRESH_MS = 5 * 60 * 1000;
/** On-demand refreshes (an unknown device knocking) at most this often. */
const ON_DEMAND_MS = 2000;

const isUnauthorized = (e: unknown): boolean => e instanceof RelayHttpError && e.status === 401;
const message = (e: unknown): string => (e instanceof Error ? e.message : "error");

/**
 * Everything that reaches beyond this machine: linking this host to an account, the relay socket,
 * and encrypted sessions with the account's consumers. The account's device list on the relay is
 * the trust root: it is cached in `devices` and refreshed periodically, on presence, and when an
 * unknown device knocks.
 */
export class Remote {
  private api: RelayApi | null = null;
  private stored: SealedFile<typeof linkedSchema> | null = null;
  private ctx: { identity: TIdentity; bus: EventBus; router: Router } | null = null;
  private deviceId: string | null = null;
  private linked: TLinked | null = null;
  private linking: TLinking | null = null;
  private link: RelayLink | null = null;
  private transport: RelayTransport | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;

  constructor(
    private readonly relayUrl: string | null,
    readonly hostName: string,
    private readonly appUrl: string,
    private readonly tokenFile: string,
    private readonly devices: DevicesService,
    private readonly log: ILogger,
  ) {}

  start(identity: TIdentity, vault: TVault, bus: EventBus, router: Router): void {
    this.deviceId = deviceIdFor(identity.signPub);
    this.ctx = { identity, bus, router };
    if (this.relayUrl === null) return;
    this.api = new RelayApi(this.relayUrl, identity, this.hostName);
    this.stored = new SealedFile(this.tokenFile, vault, linkedSchema);
    const saved = this.stored.read();
    if (saved?.relayUrl === this.relayUrl) this.connect(saved);
  }

  private readonly peers: IRelayPeers = {
    signPubOf: async (id) => {
      const known = this.devices.signPubOf(id);
      if (known) return known;
      await this.refresh(true);
      return this.devices.signPubOf(id);
    },
    seen: (id) => {
      this.devices.seen(id);
    },
    onPresence: (id, online) => {
      if (online && !this.devices.known(id)) void this.refresh(true);
    },
  };

  private connect(linked: TLinked): void {
    const { api, ctx, deviceId, relayUrl } = this;
    if (!api || !ctx || deviceId === null || relayUrl === null) return;
    this.linked = linked;
    const transport = new RelayTransport(
      ctx.identity,
      deviceId,
      { send: (text) => this.link?.send(text) ?? false },
      ctx.bus,
      ctx.router,
      this.peers,
      this.log,
    );
    this.transport = transport;
    this.link = new RelayLink({
      url: relayUrl,
      token: linked.deviceToken,
      onRemoved: () => {
        this.unlink();
      },
      stillValid: async () => {
        try {
          await api.me(linked.deviceToken);
          return true;
        } catch (e) {
          if (isUnauthorized(e)) return false;
          throw e;
        }
      },
      onText: (text) => {
        transport.onText(text);
      },
      onState: (connected) => {
        this.log.info({ connected }, "relay link");
        if (connected) void this.refresh(false);
      },
      log: this.log,
    });
    this.link.start();
    this.refreshTimer = setInterval(() => {
      void this.refresh(false);
    }, REFRESH_MS);
    this.refreshTimer.unref();
  }

  /** Re-reads the account's devices; drops sessions of devices that left it. */
  private refresh(onDemand: boolean): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (onDemand && Date.now() - this.lastRefresh < ON_DEMAND_MS) return Promise.resolve();
    const { api, linked } = this;
    if (!api || !linked) return Promise.resolve();
    this.lastRefresh = Date.now();
    this.refreshing = (async () => {
      try {
        const gone = this.devices.replace(this.deviceId, await api.devices(linked.deviceToken));
        for (const id of gone) this.transport?.dropPeer(id);
      } catch (e) {
        if (isUnauthorized(e)) this.unlink();
        else this.log.warn({ err: message(e) }, "could not refresh the account's devices");
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Forgets the account: closes the socket and sessions and deletes the sealed token. */
  private unlink(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.link?.stop();
    this.link = null;
    this.transport?.close();
    this.transport = null;
    this.linked = null;
    this.stored?.clear();
    this.devices.replace(this.deviceId, []);
  }

  private needApi(): RelayApi {
    if (!this.api) {
      throw new AgentdeckError("BAD_STATE", "No relay is configured; run `agentdeck relay set <url>` first");
    }
    return this.api;
  }

  /** Starts linking this host (or returns the code already pending) and polls until it resolves. */
  async startLink(): Promise<{ code: string; url: string; expiresAt: number }> {
    const api = this.needApi();
    if (this.linked) throw new AgentdeckError("BAD_STATE", "Already linked; run `agentdeck logout` first");
    const pending = this.linking;
    if (pending && pending.expiresAt > Date.now()) {
      return { code: pending.code, url: pending.url, expiresAt: pending.expiresAt };
    }
    this.cancelLinking();
    const started = await api.startLink();
    const url = `${this.appUrl.replace(/\/$/, "")}/link?code=${encodeURIComponent(started.code)}`;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void this.pollLink(api, started.linkId).finally(() => {
        polling = false;
      });
    }, LINK_POLL_MS);
    this.linking = { ...started, url, timer };
    return { code: started.code, url, expiresAt: started.expiresAt };
  }

  private async pollLink(api: RelayApi, linkId: string): Promise<void> {
    const { deviceId, relayUrl } = this;
    if (deviceId === null || relayUrl === null || this.linking?.linkId !== linkId) return;
    try {
      const r = await api.pollLink(linkId, deviceId);
      if (r.status === "pending") return;
      this.cancelLinking();
      if (r.status === "expired") return;
      const linked: TLinked = { relayUrl, deviceToken: r.deviceToken, email: r.accountEmail };
      this.stored?.write(linked);
      this.log.info({ email: r.accountEmail }, "linked to account");
      this.connect(linked);
    } catch (e) {
      this.log.warn({ err: message(e) }, "link poll failed");
      if (e instanceof RelayHttpError) this.cancelLinking();
    }
  }

  private cancelLinking(): void {
    if (this.linking) clearInterval(this.linking.timer);
    this.linking = null;
  }

  accountStatus(): TAccountStatus {
    if (this.relayUrl === null) return { state: "local" };
    if (this.linked) return { state: "linked", email: this.linked.email };
    const l = this.linking;
    if (l && l.expiresAt > Date.now())
      return { state: "linking", code: l.code, url: l.url, expiresAt: l.expiresAt };
    return { state: "unlinked" };
  }

  /** Leaves the account: the relay forgets this host, and this host forgets its token. */
  async logout(): Promise<void> {
    this.cancelLinking();
    const { api, linked, deviceId } = this;
    if (api && linked && deviceId !== null) {
      try {
        await api.removeDevice(linked.deviceToken, deviceId);
      } catch (e) {
        this.log.warn({ err: message(e) }, "relay did not confirm the logout");
      }
    }
    this.unlink();
  }

  status(): TRelayStatus {
    return {
      configured: this.relayUrl !== null,
      url: this.relayUrl,
      connected: this.link?.connected ?? false,
      deviceId: this.deviceId,
    };
  }

  /** Removes a device from the account. Every host drops it on its next refresh; this one now. */
  async revoke(deviceId: string): Promise<TDevice> {
    const api = this.needApi();
    if (!this.linked) throw new AgentdeckError("BAD_STATE", "This host isn't linked to an account");
    if (deviceId === this.deviceId) {
      throw new AgentdeckError("INVALID_ARGS", "To remove this host, run `agentdeck logout`");
    }
    try {
      await api.removeDevice(this.linked.deviceToken, deviceId);
    } catch (e) {
      if (e instanceof RelayHttpError && e.status === 404) {
        throw new AgentdeckError("NOT_FOUND", `No device ${deviceId} on this account`);
      }
      throw e;
    }
    this.transport?.dropPeer(deviceId);
    return this.devices.known(deviceId) ? this.devices.forget(deviceId) : this.removedStub(deviceId);
  }

  private removedStub(id: string): TDevice {
    return { id, name: id, kind: "phone", pairedAt: 0, lastSeenAt: null, revokedAt: Date.now() };
  }

  stop(): void {
    this.cancelLinking();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.link?.stop();
    this.transport?.close();
  }
}
