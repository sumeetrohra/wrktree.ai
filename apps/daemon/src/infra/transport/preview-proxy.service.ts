import { request, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";

import type { TPreviewFrame } from "@agentdeck/protocol";
import type { ILogger } from "@agentdeck/shared";
import { WebSocket, type RawData } from "ws";

/** Which port a preview token reaches: the worktree's own, or null once the preview is closed. */
export interface IPreviewPorts {
  portOf(token: string): number | null;
}

/** Raw bytes per `chunk` frame (base64 keeps a frame well under the relay's 1 MB). */
const CHUNK_BYTES = 256 * 1024;
/** What this side sends per second, under the relay's preview budget (64 MB/s). */
const BYTES_PER_SECOND = 24 * 1024 * 1024;
const IDLE_MS = 60_000;
/** Dev servers bind `localhost` as IPv4 or IPv6; Node tries both. */
const LOOPBACK = "localhost";

const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

function flatHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || DROP_RESPONSE.has(k)) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/** Whether something accepts TCP connections on `localhost:<port>` right now. */
function portOpen(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const s = connect({ host: LOOPBACK, port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => {
      s.destroy();
      resolve(false);
    });
  });
}

/** Resolves once something listens on `localhost:<port>` (checked at least once), false after `ms`. */
export async function waitForPort(
  port: number,
  ms: number,
  gaveUp: () => boolean = () => false,
): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await portOpen(port)) return true;
    if (Date.now() >= end || gaveUp()) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * The computer's end of the preview tunnel (Phase 3c): `preview` frames from the relay become
 * requests and WebSockets to the worktree's dev server, and its answers stream back. Only the port
 * of an open preview's worktree is ever reached, on loopback (SSRF guard, SEC23).
 */
export class PreviewProxy {
  private readonly requests = new Map<string, ClientRequest>();
  private readonly sockets = new Map<string, WebSocket>();
  /** What the page sent before the dev server accepted the socket. */
  private readonly early = new Map<string, (string | Buffer)[]>();
  private window = { start: 0, bytes: 0 };

  constructor(
    private readonly send: (frame: TPreviewFrame) => void,
    private readonly ports: IPreviewPorts,
    private readonly log: ILogger,
  ) {}

  onFrame(f: TPreviewFrame): void {
    switch (f.t) {
      case "req":
        this.request(f);
        return;
      case "cancel":
        this.requests.get(f.id)?.destroy();
        this.requests.delete(f.id);
        return;
      case "wsOpen":
        this.openSocket(f);
        return;
      case "wsData": {
        const ws = this.sockets.get(f.id);
        const data = f.binary ? Buffer.from(f.data, "base64") : f.data;
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
        else if (ws?.readyState === WebSocket.CONNECTING) this.early.get(f.id)?.push(data);
        return;
      }
      case "wsClose":
        this.sockets.get(f.id)?.close();
        this.sockets.delete(f.id);
        return;
      case "head":
      case "chunk":
      case "error":
        return;
    }
  }

  /** How long to hold off so this second's bytes stay under budget (0: go ahead). */
  private pace(bytes: number): number {
    const t = Date.now();
    if (t - this.window.start >= 1000) this.window = { start: t, bytes: 0 };
    this.window.bytes += bytes;
    return this.window.bytes > BYTES_PER_SECOND ? this.window.start + 1000 - t : 0;
  }

  private request(f: Extract<TPreviewFrame, { t: "req" }>): void {
    const port = this.ports.portOf(f.token);
    if (port === null || !f.path.startsWith("/")) {
      this.send({ t: "error", id: f.id, status: 404, message: "This preview is closed." });
      return;
    }
    let answered = false;
    const req = request(
      {
        host: LOOPBACK,
        port,
        method: f.method,
        path: f.path,
        headers: { ...f.headers, host: `localhost:${String(port)}` },
      },
      (res) => {
        answered = true;
        this.send({ t: "head", id: f.id, status: res.statusCode ?? 502, headers: flatHeaders(res.headers) });
        res.on("data", (data: Buffer) => {
          for (let i = 0; i < data.length; i += CHUNK_BYTES) {
            const part = data.subarray(i, i + CHUNK_BYTES);
            this.send({ t: "chunk", id: f.id, data: part.toString("base64"), last: false });
            const wait = this.pace(part.length);
            if (wait > 0 && !res.isPaused()) {
              res.pause();
              setTimeout(() => res.resume(), wait);
            }
          }
        });
        res.on("end", () => {
          this.requests.delete(f.id);
          this.send({ t: "chunk", id: f.id, data: "", last: true });
        });
        res.on("error", () => {
          this.requests.delete(f.id);
          this.send({ t: "error", id: f.id, status: 502, message: "The dev server broke off its answer." });
        });
      },
    );
    this.requests.set(f.id, req);
    req.setTimeout(IDLE_MS, () => {
      req.destroy(new Error("idle"));
    });
    req.on("error", (e) => {
      this.requests.delete(f.id);
      if (answered) return;
      this.log.debug({ err: e.message, port }, "preview request failed");
      this.send({
        t: "error",
        id: f.id,
        status: 502,
        message: "The dev server is not answering. Is the preview script running?",
      });
    });
    req.end(f.body === undefined ? undefined : Buffer.from(f.body, "base64"));
  }

  private openSocket(f: Extract<TPreviewFrame, { t: "wsOpen" }>): void {
    const port = this.ports.portOf(f.token);
    if (port === null || !f.path.startsWith("/")) {
      this.send({ t: "wsClose", id: f.id, code: 1008 });
      return;
    }
    const { "sec-websocket-protocol": protocol, ...headers } = f.headers;
    const protocols = (protocol ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const ws = new WebSocket(`ws://${LOOPBACK}:${String(port)}${f.path}`, protocols, {
      headers: { ...headers, host: `localhost:${String(port)}` },
    });
    this.sockets.set(f.id, ws);
    this.early.set(f.id, []);
    ws.on("open", () => {
      for (const d of this.early.get(f.id) ?? []) ws.send(d);
      this.early.delete(f.id);
    });
    ws.on("message", (data: RawData, binary: boolean) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(data))
          : data;
      this.send(
        binary
          ? { t: "wsData", id: f.id, data: bytes.toString("base64"), binary: true }
          : { t: "wsData", id: f.id, data: bytes.toString(), binary: false },
      );
    });
    ws.on("close", () => {
      this.early.delete(f.id);
      if (this.sockets.delete(f.id)) this.send({ t: "wsClose", id: f.id });
    });
    ws.on("error", () => {
      this.early.delete(f.id);
      if (this.sockets.delete(f.id)) this.send({ t: "wsClose", id: f.id, code: 1011 });
    });
  }

  /** Ends everything in flight (the relay socket closed, or the daemon is stopping). */
  close(): void {
    for (const r of this.requests.values()) r.destroy();
    this.requests.clear();
    for (const ws of this.sockets.values()) ws.terminate();
    this.sockets.clear();
    this.early.clear();
  }
}
