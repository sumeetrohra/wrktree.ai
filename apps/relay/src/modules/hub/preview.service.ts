import {
  previewFrameSchema,
  RELAY_SELF,
  type TPreviewFrame,
  type TPreviewOpenResult,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { tryParseJson, type ILogger } from "@agentdeck/shared";
import { z } from "zod";

import type { IClock } from "#src/shared/clock.types.js";
import { randomToken, sha256 } from "#src/shared/hash.utils.js";
import { previewToken } from "#src/shared/preview-host.utils.js";
import { PREVIEW } from "#src/shared/relay.constants.js";
import type { IHubSockets } from "#src/shared/sockets.types.js";
import type { ISql } from "#src/shared/sql.types.js";

const PREVIEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS previews (
  token TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  daemon TEXT NOT NULL,
  allowed TEXT NOT NULL,
  key_hash TEXT,
  cookie_hash TEXT,
  expires_at INTEGER NOT NULL
);
`;

const previewRowSchema = z.object({
  token: z.string(),
  worktree_id: z.string(),
  daemon: z.string(),
  key_hash: z.string().nullable(),
  cookie_hash: z.string().nullable(),
  expires_at: z.number(),
});
type TPreviewRow = z.infer<typeof previewRowSchema>;

/** A browser-side WebSocket bridged to the dev server (the host owns the real socket). */
export interface IPreviewSocket {
  send(data: string | Uint8Array): void;
  close(code: number): void;
}

type TPending = {
  daemon: string;
  head: (r: Response) => void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const COOKIE = "agentdeck_preview";

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Request headers that never cross the tunnel (hop-by-hop, or the relay's own cookie). */
const DROP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
  "x-agentdeck-preview",
  "x-agentdeck-device",
]);
const DROP_RESPONSE = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "set-cookie",
]);

function cookieOf(header: string | null): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

/**
 * The preview tunnel of one account (spec: Preview tunnelling). A token maps to one worktree on one
 * computer and one allowed device; the first load trades the one-time key for an HttpOnly cookie,
 * so a forwarded URL opens nothing. Requests and WebSockets cross the computer's relay socket as
 * `preview` frames; responses stream back with a size cap and an idle timeout. TLS only (SEC23).
 */
export class PreviewService {
  private readonly pending = new Map<string, TPending>();
  private readonly sockets = new Map<string, { daemon: string; socket: IPreviewSocket }>();

  constructor(
    private readonly sql: ISql,
    private readonly hub: IHubSockets,
    private readonly clock: IClock,
    private readonly log: ILogger,
  ) {
    sql.exec(PREVIEW_SCHEMA);
  }

  /** A computer opens a preview; the token starts with its account (lowercase), for host routing. */
  async open(
    accountId: string,
    daemon: string,
    v: { worktreeId: string; allowedDeviceId: string },
  ): Promise<Omit<TPreviewOpenResult, "url">> {
    const token = previewToken(accountId);
    const key = randomToken(24);
    const expiresAt = this.clock.now() + PREVIEW.lifetimeMs;
    this.sql.run(
      "INSERT INTO previews (token, worktree_id, daemon, allowed, key_hash, cookie_hash, expires_at) VALUES (?, ?, ?, ?, ?, NULL, ?)",
      token,
      v.worktreeId,
      daemon,
      v.allowedDeviceId,
      await sha256(key),
      expiresAt,
    );
    return { token, key, expiresAt };
  }

  close(daemon: string, token: string): void {
    this.sql.run("DELETE FROM previews WHERE token = ? AND daemon = ?", token, daemon);
  }

  private row(token: string): TPreviewRow | null {
    this.sql.run("DELETE FROM previews WHERE expires_at < ?", this.clock.now());
    const [row] = this.sql.all(
      "SELECT token, worktree_id, daemon, key_hash, cookie_hash, expires_at FROM previews WHERE token = ?",
      token,
    );
    return row === undefined ? null : previewRowSchema.parse(row);
  }

  /** Whether this request carries the preview's cookie. */
  async authorized(token: string, cookieHeader: string | null): Promise<TPreviewRow | null> {
    const row = this.row(token);
    const cookie = cookieOf(cookieHeader);
    if (row?.cookie_hash == null || cookie === null) return null;
    return (await sha256(cookie)) === row.cookie_hash ? row : null;
  }

  /** One browser request to `<token>.preview.<domain>`. */
  async request(req: Request, token: string): Promise<Response> {
    const url = new URL(req.url);
    const key = url.searchParams.get("k");
    if (key !== null) return this.redeem(token, key, url);
    const row = await this.authorized(token, req.headers.get("cookie"));
    if (!row) return text(403, "This preview link only opens on the device that started it.");
    const body =
      req.method === "GET" || req.method === "HEAD" ? null : new Uint8Array(await req.arrayBuffer());
    if (body && body.length > PREVIEW.maxBodyBytes) return text(413, "Request too large");
    const id = randomToken(12);
    const frame: TPreviewFrame = {
      t: "req",
      id,
      token,
      method: req.method,
      path: url.pathname + url.search,
      headers: forwardHeaders(req.headers),
      ...(body && body.length > 0 ? { body: bytesToB64(body) } : {}),
    };
    return new Promise<Response>((resolve) => {
      const p: TPending = { daemon: row.daemon, head: resolve, controller: null, bytes: 0, timer: null };
      this.pending.set(id, p);
      this.touch(id, p);
      if (!this.send(row.daemon, frame)) {
        this.pending.delete(id);
        if (p.timer) clearTimeout(p.timer);
        resolve(text(502, "The computer running this preview is offline."));
      }
    });
  }

  /** `?k=` once: set the cookie and redirect to the same URL without the key. */
  private async redeem(token: string, key: string, url: URL): Promise<Response> {
    const row = this.row(token);
    if (row?.key_hash == null || (await sha256(key)) !== row.key_hash) {
      return text(403, "This preview link has already been used, or has expired.");
    }
    const cookie = randomToken(32);
    this.sql.run(
      "UPDATE previews SET key_hash = NULL, cookie_hash = ? WHERE token = ?",
      await sha256(cookie),
      token,
    );
    url.searchParams.delete("k");
    const secure = url.protocol === "https:" ? "; Secure" : "";
    const maxAge = Math.max(0, Math.floor((row.expires_at - this.clock.now()) / 1000));
    return new Response(null, {
      status: 302,
      headers: {
        location: url.pathname + url.search,
        "set-cookie": `${COOKIE}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(maxAge)}${secure}`,
      },
    });
  }

  private send(daemon: string, frame: TPreviewFrame): boolean {
    const outer: TRelayFrame = {
      v: 1,
      to: daemon,
      from: RELAY_SELF,
      seq: 0,
      kind: "preview",
      body: JSON.stringify(frame),
    };
    return this.hub.send(daemon, JSON.stringify(outer));
  }

  /** Idle timeout: no frame from the computer for a while ends the response. */
  private touch(id: string, p: TPending): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      this.fail(id, 504, "The dev server took too long to answer.");
    }, PREVIEW.idleMs);
  }

  private fail(id: string, status: number, message: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    if (p.controller) {
      try {
        p.controller.error(new Error(message));
      } catch {
        // already closed
      }
    } else p.head(text(status, message));
    this.send(p.daemon, { t: "cancel", id });
  }

  /** A `preview` frame from a computer: a response part, or WebSocket traffic. */
  onFrame(daemon: string, frame: TRelayFrame): void {
    const f = tryParseJson(previewFrameSchema, frame.body);
    if (!f) return;
    switch (f.t) {
      case "head": {
        const p = this.pending.get(f.id);
        if (p?.daemon !== daemon) return;
        this.touch(f.id, p);
        const headers = new Headers();
        for (const [k, v] of Object.entries(f.headers))
          if (!DROP_RESPONSE.has(k.toLowerCase())) headers.set(k, v);
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            p.controller = controller;
          },
          cancel: () => {
            this.pending.delete(f.id);
            if (p.timer) clearTimeout(p.timer);
            this.send(daemon, { t: "cancel", id: f.id });
          },
        });
        const bodyless = f.status === 204 || f.status === 304;
        p.head(new Response(bodyless ? null : stream, { status: f.status, headers }));
        return;
      }
      case "chunk": {
        const p = this.pending.get(f.id);
        if (p?.daemon !== daemon || !p.controller) return;
        const bytes = b64ToBytes(f.data);
        p.bytes += bytes.length;
        if (p.bytes > PREVIEW.maxResponseBytes) {
          this.fail(f.id, 502, "Response too large for the preview tunnel");
          return;
        }
        this.touch(f.id, p);
        if (bytes.length > 0) p.controller.enqueue(bytes);
        if (f.last) {
          this.pending.delete(f.id);
          if (p.timer) clearTimeout(p.timer);
          p.controller.close();
        }
        return;
      }
      case "error": {
        const p = this.pending.get(f.id);
        if (p?.daemon !== daemon) return;
        this.fail(f.id, f.status, f.message);
        return;
      }
      case "wsData": {
        const s = this.sockets.get(f.id);
        if (s?.daemon !== daemon) return;
        s.socket.send(f.binary ? b64ToBytes(f.data) : f.data);
        return;
      }
      case "wsClose": {
        const s = this.sockets.get(f.id);
        if (s?.daemon !== daemon) return;
        this.sockets.delete(f.id);
        s.socket.close(1000);
        return;
      }
      case "req":
      case "cancel":
      case "wsOpen":
        return;
    }
  }

  /** A browser WebSocket on an authorized preview: bridge it to the dev server. False if offline. */
  openSocket(
    id: string,
    row: { token: string; daemon: string },
    path: string,
    headers: Headers,
    socket: IPreviewSocket,
  ): boolean {
    this.sockets.set(id, { daemon: row.daemon, socket });
    const ok = this.send(row.daemon, {
      t: "wsOpen",
      id,
      token: row.token,
      path,
      headers: forwardHeaders(headers),
    });
    if (!ok) this.sockets.delete(id);
    return ok;
  }

  socketMessage(id: string, data: string | ArrayBuffer | Uint8Array): void {
    const s = this.sockets.get(id);
    if (!s) return;
    const frame: TPreviewFrame =
      typeof data === "string"
        ? { t: "wsData", id, data, binary: false }
        : {
            t: "wsData",
            id,
            data: bytesToB64(data instanceof Uint8Array ? data : new Uint8Array(data)),
            binary: true,
          };
    this.send(s.daemon, frame);
  }

  socketClosed(id: string): void {
    const s = this.sockets.get(id);
    if (!s) return;
    this.sockets.delete(id);
    this.send(s.daemon, { t: "wsClose", id });
  }

  /** The computer went offline: end everything in flight through it. */
  daemonGone(daemon: string): void {
    for (const [id, p] of this.pending)
      if (p.daemon === daemon) this.fail(id, 502, "The computer went offline.");
    for (const [id, s] of this.sockets) {
      if (s.daemon !== daemon) continue;
      this.sockets.delete(id);
      s.socket.close(1001);
    }
    this.log.info({ daemon }, "preview traffic ended: computer offline");
  }
}

/** WebSocket handshake headers stay at the relay, except the subprotocol (Vite's HMR needs it). */
function forwardHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    const name = k.toLowerCase();
    if (DROP_REQUEST.has(name)) return;
    if (name.startsWith("sec-websocket") && name !== "sec-websocket-protocol") return;
    out[name] = v;
  });
  return out;
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
