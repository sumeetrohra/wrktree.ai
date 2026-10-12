import { relayFrameSchema, type TRelayControl, type TRelayFrame } from "@agentdeck/protocol";
import { tryParseJson, type ILogger } from "@agentdeck/shared";

import type { IClock } from "#src/shared/clock.types.js";
import type { IPushSender } from "#src/shared/push.types.js";
import { CLOSE, RELAY_LIMITS } from "#src/shared/relay.constants.js";
import type { IHubSockets, TMember } from "#src/shared/sockets.types.js";
import type { ISql } from "#src/shared/sql.types.js";

import {
  frameRowSchema,
  gapRowSchema,
  HUB_SCHEMA,
  memberRowSchema,
  pairRowSchema,
  totalsRowSchema,
} from "./hub.schema.js";

type TWindow = { start: number; frames: number; bytes: number };

/**
 * One account's mailbox (spec: Durable Object `AccountHub`). It checks that `from` matches the
 * socket and `to` is on the account, forwards to a connected device or stores the frame, deletes
 * stored frames when the recipient acks them, and push-wakes an offline phone for `wake` frames.
 * It never sees plaintext: `msg` bodies are sealed end to end.
 */
export class HubService {
  /** Rate windows live in memory; a hibernating Durable Object simply starts a fresh window. */
  private readonly windows = new Map<string, TWindow>();

  constructor(
    private readonly sql: ISql,
    private readonly sockets: IHubSockets,
    private readonly push: IPushSender,
    private readonly clock: IClock,
    private readonly log: ILogger,
  ) {
    sql.exec(HUB_SCHEMA);
  }

  private member(
    deviceId: string,
  ): { kind: TMember["kind"]; pushToken: string | null; lastPushAt: number | null } | null {
    const [row] = this.sql.all(
      "SELECT device_id, kind, push_token, last_push_at FROM members WHERE device_id = ?",
      deviceId,
    );
    if (row === undefined) return null;
    const m = memberRowSchema.parse(row);
    return { kind: m.kind, pushToken: m.push_token, lastPushAt: m.last_push_at };
  }

  addMember(member: TMember): void {
    this.sql.run(
      "INSERT INTO members (device_id, kind) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET kind = excluded.kind",
      member.deviceId,
      member.kind,
    );
  }

  /** Revoked or moved to another account: drop its socket, push token and stored frames. */
  removeMember(deviceId: string, reason: "revoked" | "moved"): void {
    this.sql.run("DELETE FROM members WHERE device_id = ?", deviceId);
    this.sql.run("DELETE FROM frames WHERE target = ? OR sender = ?", deviceId, deviceId);
    this.sql.run("DELETE FROM gaps WHERE target = ? OR sender = ?", deviceId, deviceId);
    this.sockets.close(deviceId, reason === "revoked" ? CLOSE.REVOKED : CLOSE.MOVED, reason);
  }

  setPushToken(deviceId: string, token: string): boolean {
    if (!this.member(deviceId)) return false;
    this.sql.run("UPDATE members SET push_token = ? WHERE device_id = ?", token, deviceId);
    return true;
  }

  connected(): string[] {
    return this.sockets.connected();
  }

  /** Called once the host has attached the new socket. Flushes stored frames and gap markers. */
  onConnect(deviceId: string): void {
    this.expire();
    for (const row of this.sql.all("SELECT sender FROM gaps WHERE target = ?", deviceId)) {
      this.control(deviceId, { t: "relay.gap", from: gapRowSchema.parse(row).sender });
    }
    this.sql.run("DELETE FROM gaps WHERE target = ?", deviceId);
    for (const row of this.sql.all("SELECT id, frame FROM frames WHERE target = ? ORDER BY id", deviceId)) {
      this.sockets.send(deviceId, frameRowSchema.parse(row).frame);
    }
    this.broadcastPresence(deviceId, true);
  }

  onClose(deviceId: string): void {
    this.windows.delete(deviceId);
    this.broadcastPresence(deviceId, false);
  }

  private broadcastPresence(deviceId: string, online: boolean): void {
    for (const other of this.sockets.connected()) {
      if (other !== deviceId) this.control(other, { t: "relay.presence", deviceId, online });
    }
  }

  private control(deviceId: string, frame: TRelayControl): void {
    this.sockets.send(deviceId, JSON.stringify(frame));
  }

  /** Per-device frame and byte budget; the daemon's is larger because it streams blobs. */
  private overLimit(deviceId: string, kind: TMember["kind"], bytes: number): boolean {
    const t = this.clock.now();
    const w = this.windows.get(deviceId);
    const win = w && t - w.start < 1000 ? w : { start: t, frames: 0, bytes: 0 };
    win.frames++;
    win.bytes += bytes;
    this.windows.set(deviceId, win);
    const limit = kind === "daemon" ? RELAY_LIMITS.daemon : RELAY_LIMITS.phone;
    return win.frames > limit.framesPerSecond || win.bytes > limit.bytesPerSecond;
  }

  async onMessage(deviceId: string, raw: string): Promise<void> {
    const sender = this.member(deviceId);
    if (!sender) {
      this.sockets.close(deviceId, CLOSE.REVOKED, "not a member");
      return;
    }
    const bytes = raw.length;
    if (bytes > RELAY_LIMITS.frameBytes) {
      this.sockets.close(deviceId, CLOSE.TOO_BIG, "frame too large");
      return;
    }
    if (this.overLimit(deviceId, sender.kind, bytes)) {
      this.log.warn({ deviceId }, "relay rate limit");
      this.sockets.close(deviceId, CLOSE.RATE_LIMIT, "rate limit");
      return;
    }
    const frame = tryParseJson(relayFrameSchema, raw);
    if (frame?.from !== deviceId) return; // spoofed or malformed: drop silently
    if (frame.kind === "ping") return;
    if (frame.kind === "ack") {
      this.ack(deviceId, frame);
      return;
    }
    const target = this.member(frame.to);
    if (!target || frame.to === deviceId) {
      this.control(deviceId, { t: "relay.undeliverable", to: frame.to, seq: frame.seq });
      return;
    }
    if (this.sockets.send(frame.to, raw)) return;
    this.store(frame, raw);
    if (frame.wake === true && target.pushToken !== null)
      await this.wake(frame.to, target.pushToken, target.lastPushAt);
  }

  /** The recipient acked `seq` of session `sid` from `to`: delete what it has. */
  private ack(deviceId: string, frame: TRelayFrame): void {
    this.sql.run(
      "DELETE FROM frames WHERE target = ? AND sender = ? AND (sid IS ? AND seq <= ?)",
      deviceId,
      frame.to,
      frame.sid ?? null,
      frame.seq,
    );
  }

  /** Stores for an offline device; past the caps the oldest frames go and a gap marker stays. */
  private store(frame: TRelayFrame, raw: string): void {
    this.sql.run(
      "INSERT INTO frames (target, sender, seq, sid, bytes, frame, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      frame.to,
      frame.from,
      frame.seq,
      frame.sid ?? null,
      raw.length,
      raw,
      this.clock.now(),
    );
    for (;;) {
      const [row] = this.sql.all(
        "SELECT COUNT(*) AS n, SUM(bytes) AS bytes FROM frames WHERE target = ?",
        frame.to,
      );
      const totals = totalsRowSchema.parse(row);
      if (totals.n <= RELAY_LIMITS.bufferFrames && (totals.bytes ?? 0) <= RELAY_LIMITS.bufferBytes) return;
      const [oldest] = this.sql.all(
        "SELECT id, frame FROM frames WHERE target = ? ORDER BY id LIMIT 1",
        frame.to,
      );
      if (oldest === undefined) return;
      const { id } = frameRowSchema.parse(oldest);
      const dropped = this.sql
        .all("SELECT sender FROM frames WHERE id = ?", id)
        .map((r) => gapRowSchema.parse(r).sender);
      this.sql.run("DELETE FROM frames WHERE id = ?", id);
      for (const s of dropped)
        this.sql.run("INSERT OR IGNORE INTO gaps (target, sender) VALUES (?, ?)", frame.to, s);
    }
  }

  private expire(): void {
    const cutoff = this.clock.now() - RELAY_LIMITS.bufferTtlMs;
    const dropped = this.sql.all("SELECT DISTINCT target, sender FROM frames WHERE at < ?", cutoff);
    this.sql.run("DELETE FROM frames WHERE at < ?", cutoff);
    for (const row of dropped) {
      const { target, sender } = pairRowSchema.parse(row);
      this.sql.run("INSERT OR IGNORE INTO gaps (target, sender) VALUES (?, ?)", target, sender);
    }
  }

  private async wake(deviceId: string, token: string, lastPushAt: number | null): Promise<void> {
    const t = this.clock.now();
    if (lastPushAt !== null && t - lastPushAt < RELAY_LIMITS.pushIntervalMs) return;
    this.sql.run("UPDATE members SET last_push_at = ? WHERE device_id = ?", t, deviceId);
    try {
      await this.push.send(deviceId, token);
    } catch (e) {
      this.log.warn({ deviceId, err: e instanceof Error ? e.message : "push failed" }, "push failed");
    }
  }
}
