import { randomBytes } from "node:crypto";

import {
  BLOB_PART_SIZE,
  FRAME_BLOB_THRESHOLD,
  innerSchema,
  type TEvtFrame,
  type TInner,
  type TLoggedEvent,
} from "@agentdeck/protocol";
import { now, tryParseJson, type ILogger } from "@agentdeck/shared";

import { topicMatches, type EventBus } from "../bus/index.js";
import type { Router } from "../rpc/index.js";

import { LIMITS } from "./transport.constants.js";

type TUpload = { parts: Buffer[]; size: number; done: boolean };

/**
 * Where a connection's frames go: a local WebSocket, or a sealed session to a paired device
 * through the relay. Text in and out is the plaintext inner frame JSON.
 */
export interface IFrameChannel {
  send(text: string): void;
  close(reason: string): void;
}

/**
 * One authenticated client, whatever carries it. Subscriptions, `sync.hello` replay, uploads and
 * per-connection resource limits (SEC9) live here, so every transport behaves the same.
 */
export class Connection {
  private readonly subs = new Set<string>();
  /** Highest cursor sent per topic, so replay and live events never duplicate. */
  private readonly sent = new Map<string, number>();
  private readonly uploads = new Map<string, TUpload>();
  private pendingUploadBytes = 0;
  private windowStart = now();
  private framesInWindow = 0;
  private readonly unlisten: () => void;

  private disposed = false;

  constructor(
    readonly id: string,
    private readonly channel: IFrameChannel,
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: ILogger,
  ) {
    this.unlisten = bus.on((e) => {
      this.onEvent(e);
    });
  }

  /** Stops event delivery; call when the underlying socket or session ends. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlisten();
  }

  private send(frame: TInner): void {
    if (!this.disposed) this.channel.send(JSON.stringify(frame));
  }

  private sendEvent(e: TLoggedEvent): void {
    if ((this.sent.get(e.topic) ?? 0) >= e.cursor) return;
    this.sent.set(e.topic, e.cursor);
    const frame: TEvtFrame = { t: "evt", topic: e.topic, cursor: e.cursor, event: e.event };
    this.send(frame);
  }

  private onEvent(e: TLoggedEvent): void {
    for (const s of this.subs) {
      if (topicMatches(s, e.topic)) {
        this.sendEvent(e);
        return;
      }
    }
  }

  /** Synchronous: no event can be published between the replay and going live. */
  subscribe(cursors: Readonly<Record<string, number>>): void {
    for (const [pattern, after] of Object.entries(cursors)) {
      this.subs.add(pattern);
      // An explicit topic key wins over a wildcard that also covers it.
      const topics = pattern.endsWith(":*")
        ? this.bus.topics(pattern).filter((t) => !Object.hasOwn(cursors, t))
        : [pattern];
      for (const topic of topics) {
        const from = Math.max(after, this.sent.get(topic) ?? 0);
        if (from > (this.sent.get(topic) ?? 0)) this.sent.set(topic, from);
        for (const e of this.bus.replay(topic, from)) this.sendEvent(e);
      }
    }
  }

  private takeUpload(uploadId: string): Buffer | undefined {
    const u = this.uploads.get(uploadId);
    if (!u?.done) return undefined;
    this.uploads.delete(uploadId);
    this.pendingUploadBytes -= u.size;
    return Buffer.concat(u.parts);
  }

  private close(reason: string): void {
    this.log.warn({ conn: this.id, reason }, "closing connection");
    this.dispose();
    this.channel.close(reason);
  }

  private overRate(): boolean {
    const t = now();
    if (t - this.windowStart >= 1000) {
      this.windowStart = t;
      this.framesInWindow = 0;
    }
    this.framesInWindow++;
    return this.framesInWindow > LIMITS.framesPerSecond;
  }

  async receive(raw: string): Promise<void> {
    if (this.disposed) return;
    if (this.overRate()) {
      this.close("rate limit");
      return;
    }
    const frame = tryParseJson(innerSchema, raw);
    if (!frame) {
      this.log.warn({ conn: this.id }, "dropped malformed frame");
      return;
    }
    if (frame.t === "blob") {
      this.onBlob(frame.blobId, frame.part, frame.last, frame.bytes);
      return;
    }
    if (frame.t !== "cmd") return;

    const hooks: { after?: () => void } = {};
    const reply = await this.router.dispatch(frame.id, frame.name, frame.args, {
      deviceId: this.id,
      takeUpload: (id) => this.takeUpload(id),
      afterReply: (fn) => {
        hooks.after = fn;
      },
      subscribe: (cursors) => {
        this.subscribe(cursors);
      },
    });
    if (reply.ok) this.sendData(frame.id, reply.data);
    else this.send({ t: "res", id: frame.id, ok: false, error: reply.error });
    hooks.after?.();
  }

  private onBlob(blobId: string, part: number, last: boolean, base64: string): void {
    const bytes = Buffer.from(base64, "base64");
    const existing = this.uploads.get(blobId);
    if (!existing && this.uploads.size >= LIMITS.concurrentUploads) {
      this.close("too many uploads");
      return;
    }
    const u = existing ?? { parts: [], size: 0, done: false };
    u.size += bytes.length;
    this.pendingUploadBytes += bytes.length;
    if (u.size > LIMITS.uploadBytes || this.pendingUploadBytes > LIMITS.pendingUploadBytes) {
      this.close("upload too large");
      return;
    }
    u.parts[part] = bytes;
    u.done = last;
    this.uploads.set(blobId, u);
  }

  /** Inner frames above the threshold travel as blob parts, then a `{ $blob }` reply. */
  private sendData(id: string, data: unknown): void {
    const json = JSON.stringify(data ?? {});
    if (json.length <= FRAME_BLOB_THRESHOLD) {
      this.send({ t: "res", id, ok: true, data: data ?? {} });
      return;
    }
    const blobId = randomBytes(12).toString("hex");
    const buf = Buffer.from(json);
    const parts = Math.ceil(buf.length / BLOB_PART_SIZE);
    for (let i = 0; i < parts; i++) {
      const bytes = buf.subarray(i * BLOB_PART_SIZE, (i + 1) * BLOB_PART_SIZE).toString("base64");
      this.send({ t: "blob", blobId, part: i, last: i === parts - 1, bytes });
    }
    this.send({ t: "res", id, ok: true, data: { $blob: blobId } });
  }
}
