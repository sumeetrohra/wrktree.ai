import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  BLOB_PART_SIZE,
  FRAME_BLOB_THRESHOLD,
  innerSchema,
  type TEvtFrame,
  type TInner,
  type TLoggedEvent,
} from "@agentdeck/protocol";
import { now, tryParseJson, type ILogger } from "@agentdeck/shared";
import { WebSocketServer, type WebSocket } from "ws";

import { topicMatches, type EventBus } from "../bus/index.js";
import type { Router } from "../rpc/index.js";

import { LIMITS, TOKEN_PROTOCOL_PREFIX } from "./transport.constants.js";

type TUpload = { parts: Buffer[]; size: number; done: boolean };

/** One authenticated client. Enforces per-connection resource limits (SEC9). */
class Connection {
  private readonly subs = new Set<string>();
  /** Highest cursor sent per topic, so replay and live events never duplicate. */
  private readonly sent = new Map<string, number>();
  private readonly uploads = new Map<string, TUpload>();
  private pendingUploadBytes = 0;
  private windowStart = now();
  private framesInWindow = 0;
  private readonly unlisten: () => void;

  constructor(
    readonly id: string,
    private readonly ws: WebSocket,
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: ILogger,
  ) {
    this.unlisten = bus.on((e) => {
      this.onEvent(e);
    });
    ws.on("message", (raw: Buffer) => {
      void this.onMessage(raw.toString());
    });
    ws.on("close", () => {
      this.unlisten();
    });
  }

  private send(frame: TInner): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(frame));
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
    this.ws.close(1008, reason);
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

  private async onMessage(raw: string): Promise<void> {
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

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Localhost HTTP + WebSocket transport for the CLI and, later, the desktop web UI.
 *
 * Checks on every upgrade (SEC3, SEC4):
 * - the token comes from `Authorization: Bearer …` or a `agentdeck.token.<token>` subprotocol,
 *   never the URL;
 * - `Host` must be this listener (`127.0.0.1:<port>` or `localhost:<port>`), which defeats DNS
 *   rebinding;
 * - a browser `Origin`, if present, must be the daemon's own origin.
 */
export class LocalTransport {
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private seq = 0;
  private port = 0;
  readonly token = randomBytes(24).toString("hex");

  constructor(
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: ILogger,
    version: string,
  ) {
    this.server = createServer((req, res) => {
      if (req.url === "/health" && this.hostAllowed(req)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, version }));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: LIMITS.frameBytes,
      handleProtocols: (protocols) => (protocols.has("agentdeck.v1") ? "agentdeck.v1" : false),
    });
    this.server.on("upgrade", (req, socket, head) => {
      const reason = this.rejectReason(req);
      if (reason) {
        this.log.warn({ reason }, "rejected websocket upgrade");
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        new Connection(`local-${String(++this.seq)}`, ws, this.bus, this.router, this.log);
      });
    });
  }

  private allowedHosts(): string[] {
    return [`127.0.0.1:${String(this.port)}`, `localhost:${String(this.port)}`];
  }

  private hostAllowed(req: IncomingMessage): boolean {
    return this.allowedHosts().includes((req.headers.host ?? "").toLowerCase());
  }

  /** Why this upgrade must be refused, or null when it is fine. */
  private rejectReason(req: IncomingMessage): string | null {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/v1/ws") return "path";
    if (url.searchParams.has("token")) return "token in url";
    if (!this.hostAllowed(req)) return "host";
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowedHosts().some((h) => origin === `http://${h}`)) return "origin";
    const header = req.headers.authorization?.replace(/^Bearer /, "");
    const fromProtocol = (req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX))
      ?.slice(TOKEN_PROTOCOL_PREFIX.length);
    const given = header ?? fromProtocol ?? "";
    return safeEqual(given, this.token) ? null : "token";
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port = typeof addr === "object" && addr ? (addr satisfies AddressInfo).port : port;
        resolve(this.port);
      });
    });
  }

  close(): Promise<void> {
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}
