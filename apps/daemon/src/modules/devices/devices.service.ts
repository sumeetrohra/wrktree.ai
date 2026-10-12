import { fromB64 } from "@agentdeck/crypto";
import { AgentdeckError, type TDevice, type TDeviceKind } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";

import type { TRuntime } from "#src/infra/runtime/index.js";

type TRow = {
  id: string;
  name: string;
  kind: TDeviceKind;
  public_key: string;
  paired_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  confirmed_at: number | null;
};

const toDevice = (r: TRow): TDevice => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  pairedAt: r.paired_at,
  lastSeenAt: r.last_seen_at,
  revokedAt: r.revoked_at,
});

/**
 * Devices paired with this daemon. A device is usable only after the user confirmed the short
 * code on the desktop, and never again once revoked.
 */
export class DevicesService {
  constructor(private readonly rt: TRuntime) {}

  private row(id: string): TRow | undefined {
    return this.rt.db.prepare<[string], TRow>("SELECT * FROM devices WHERE id = ?").get(id);
  }

  private publish(id: string): void {
    const r = this.row(id);
    if (r) this.rt.bus.publish("global", { type: "device.updated", device: toDevice(r) });
  }

  /** Confirmed devices, newest first. */
  list(): TDevice[] {
    return this.rt.db
      .prepare<[], TRow>("SELECT * FROM devices WHERE confirmed_at IS NOT NULL ORDER BY paired_at DESC")
      .all()
      .map(toDevice);
  }

  /** Records a phone that proved it saw the QR code; it can't connect until `confirm`. */
  addPending(d: { id: string; name: string; kind: TDeviceKind; signPub: string }): void {
    const existing = this.row(d.id);
    if (existing?.revoked_at != null) throw new AgentdeckError("FORBIDDEN_PATH", "This device was revoked");
    this.rt.db
      .prepare(
        `INSERT INTO devices (id, name, kind, public_key, paired_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, public_key = excluded.public_key`,
      )
      .run(d.id, d.name, d.kind, d.signPub, now());
  }

  confirm(id: string): void {
    this.rt.db
      .prepare("UPDATE devices SET confirmed_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now(), id);
    this.publish(id);
  }

  /** Forgets a pending device the user rejected. Confirmed devices are revoked instead. */
  forgetPending(id: string): void {
    this.rt.db.prepare("DELETE FROM devices WHERE id = ? AND confirmed_at IS NULL").run(id);
  }

  revoke(id: string): TDevice {
    const r = this.row(id);
    if (!r) throw new AgentdeckError("NOT_FOUND", `No device ${id}`);
    if (r.revoked_at === null)
      this.rt.db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(now(), id);
    this.publish(id);
    const after = this.row(id);
    if (!after) throw new AgentdeckError("NOT_FOUND", `No device ${id}`);
    return toDevice(after);
  }

  /** The device's signing key if it may open a session: confirmed and not revoked. */
  signPubOf(id: string): Uint8Array | null {
    const r = this.row(id);
    if (r?.confirmed_at == null || r.revoked_at !== null) return null;
    try {
      return fromB64(r.public_key);
    } catch {
      return null;
    }
  }

  seen(id: string): void {
    this.rt.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now(), id);
  }
}
