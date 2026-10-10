import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  BLOB_PART_SIZE,
  FRAME_BLOB_THRESHOLD,
  Inner,
  type EvtFrame,
  type LoggedEvent,
} from "@agentdeck/protocol";
import type { Logger } from "@agentdeck/shared";
import { topicMatches, type EventBus } from "../bus.js";
import type { Router } from "../router.js";

const MAX_UPLOAD = 50 * 1024 * 1024;

/** Called by `sync.hello` after its reply is sent: replay what the client missed, then go live. */
export type Subscribe = (cursors: Record<string, number>) => void;

class Connection {
  private subs = new Set<string>();
  /** Highest cursor sent per topic, so replay and live events never duplicate. */
  private sent = new Map<string, number>();
  private uploads = new Map<string, { parts: Buffer[]; size: number; done: boolean }>();
  private unlisten: () => void;

  constructor(
    readonly id: string,
    private readonly ws: WebSocket,
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: Logger,
  ) {
    this.unlisten = bus.on((e) => this.onEvent(e));
    ws.on("message", (raw) => void this.onMessage(raw.toString()));
    ws.on("close", () => this.unlisten());
  }

  private send(frame: Inner): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private sendEvent(e: LoggedEvent): void {
    if ((this.sent.get(e.topic) ?? 0) >= e.cursor) return;
    this.sent.set(e.topic, e.cursor);
    const frame: EvtFrame = { t: "evt", topic: e.topic, cursor: e.cursor, event: e.event };
    this.send(frame);
  }

  private onEvent(e: LoggedEvent): void {
    for (const s of this.subs) {
      if (topicMatches(s, e.topic)) return this.sendEvent(e);
    }
  }

  /** Synchronous: no event can be published between the replay and going live. */
  subscribe(cursors: Record<string, number>): void {
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
    return Buffer.concat(u.parts);
  }

  private async onMessage(raw: string): Promise<void> {
    let frame: Inner;
    try {
      frame = Inner.parse(JSON.parse(raw));
    } catch {
      this.log.warn({ conn: this.id }, "dropped malformed frame");
      return;
    }
    if (frame.t === "blob") {
      const u = this.uploads.get(frame.blobId) ?? { parts: [], size: 0, done: false };
      const bytes = Buffer.from(frame.bytes, "base64");
      u.size += bytes.length;
      if (u.size > MAX_UPLOAD) {
        this.uploads.delete(frame.blobId);
        return;
      }
      u.parts[frame.part] = bytes;
      u.done = frame.last;
      this.uploads.set(frame.blobId, u);
      return;
    }
    if (frame.t !== "cmd") return;

    let after: (() => void) | null = null;
    const reply = await this.router.dispatch(frame.id, frame.name, frame.args, {
      deviceId: this.id,
      takeUpload: (id) => this.takeUpload(id),
      afterReply: (fn) => {
        after = fn;
      },
      subscribe: (cursors) => this.subscribe(cursors),
    });
    if (reply.ok) {
      const json = JSON.stringify(reply.data ?? {});
      if (json.length > FRAME_BLOB_THRESHOLD) {
        const blobId = randomBytes(12).toString("hex");
        const buf = Buffer.from(json);
        const parts = Math.ceil(buf.length / BLOB_PART_SIZE);
        for (let i = 0; i < parts; i++) {
          const bytes = buf.subarray(i * BLOB_PART_SIZE, (i + 1) * BLOB_PART_SIZE).toString("base64");
          this.send({ t: "blob", blobId, part: i, last: i === parts - 1, bytes });
        }
        this.send({ t: "res", id: frame.id, ok: true, data: { $blob: blobId } });
      } else {
        this.send({ t: "res", id: frame.id, ok: true, data: reply.data ?? {} });
      }
    } else {
      this.send({ t: "res", id: frame.id, ok: false, error: reply.error });
    }
    (after as (() => void) | null)?.();
  }
}

/**
 * Localhost HTTP + WebSocket transport for the CLI and, later, the desktop web UI.
 * Clients authenticate with the token in `local-token` (a 0600 file).
 */
export class LocalTransport {
  private server: Server;
  private wss: WebSocketServer;
  private seq = 0;
  readonly token = randomBytes(24).toString("hex");

  constructor(
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: Logger,
    version: string,
  ) {
    this.server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, version }));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
    this.server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const given = url.searchParams.get("token") ?? req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const ok =
        url.pathname === "/v1/ws" &&
        given.length === this.token.length &&
        timingSafeEqual(Buffer.from(given), Buffer.from(this.token));
      if (!ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        new Connection(`local-${++this.seq}`, ws, this.bus, this.router, this.log);
      });
    });
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => resolve((this.server.address() as AddressInfo).port));
    });
  }

  close(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
