import { fromB64 } from "@agentdeck/crypto";
import { AgentdeckError, type TDevice, type TRelayDevice } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";

import type { TRuntime } from "#src/infra/runtime/index.js";

const CONSUMER_KINDS: readonly string[] = ["phone", "web"];

/**
 * The account's devices, as last fetched from the relay. Membership is the trust root: a consumer
 * (phone, web) on the account may open a session with this host; one removed from it may not.
 */
export class DevicesService {
  private devices = new Map<string, TRelayDevice>();
  private readonly lastSeen = new Map<string, number>();
  private selfId: string | null = null;

  constructor(private readonly rt: TRuntime) {}

  private toDevice(d: TRelayDevice, revokedAt: number | null = null): TDevice {
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      pairedAt: d.createdAt,
      lastSeenAt: this.lastSeen.get(d.id) ?? null,
      revokedAt,
      connected: d.connected,
      self: d.id === this.selfId,
    };
  }

  /** The account's devices, oldest first, this host included. Empty until linked. */
  list(): TDevice[] {
    return [...this.devices.values()].map((d) => this.toDevice(d));
  }

  /**
   * Replaces the cached list. Publishes `device.updated` for each change and returns the ids that
   * left the account, so their sessions can be dropped.
   */
  replace(selfId: string | null, next: readonly TRelayDevice[]): string[] {
    this.selfId = selfId;
    const before = this.devices;
    this.devices = new Map(next.map((d) => [d.id, d]));
    const gone = [...before.values()].filter((d) => !this.devices.has(d.id));
    for (const d of gone) {
      this.rt.bus.publish("global", { type: "device.updated", device: this.toDevice(d, now()) });
    }
    for (const d of next) {
      const old = before.get(d.id);
      if (old?.name !== d.name || old.connected !== d.connected) {
        this.rt.bus.publish("global", { type: "device.updated", device: this.toDevice(d) });
      }
    }
    return gone.map((d) => d.id);
  }

  /** Forgets one device at once (removed by this host), ahead of the next refresh. */
  forget(id: string): TDevice {
    const d = this.devices.get(id);
    if (!d) throw new AgentdeckError("NOT_FOUND", `No device ${id} on this account`);
    this.devices.delete(id);
    const removed = this.toDevice(d, now());
    this.rt.bus.publish("global", { type: "device.updated", device: removed });
    return removed;
  }

  known(id: string): boolean {
    return this.devices.has(id);
  }

  /** The signing key of a consumer on the account, or null: hosts don't open sessions with hosts. */
  signPubOf(id: string): Uint8Array | null {
    const d = this.devices.get(id);
    if (!d || !CONSUMER_KINDS.includes(d.kind)) return null;
    try {
      return fromB64(d.signPub);
    } catch {
      return null;
    }
  }

  seen(id: string): void {
    this.lastSeen.set(id, now());
  }
}
