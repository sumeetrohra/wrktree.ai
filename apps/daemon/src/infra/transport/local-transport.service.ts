import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { ILogger } from "@agentdeck/shared";
import { WebSocketServer } from "ws";

import type { EventBus } from "../bus/index.js";
import type { Router } from "../rpc/index.js";

import { Connection } from "./connection.service.js";
import { LIMITS, TOKEN_PROTOCOL_PREFIX } from "./transport.constants.js";
import { WebUi } from "./web-ui.service.js";

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
  private readonly web: WebUi;

  constructor(
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly log: ILogger,
    version: string,
    private readonly devOrigins: readonly string[] = [],
    webRoot: string | null = null,
  ) {
    this.web = new WebUi(
      webRoot,
      () => this.token,
      () => this.allowedHosts().map((h) => `http://${h}`),
    );
    this.server = createServer((req, res) => {
      if (!this.hostAllowed(req)) {
        res.writeHead(404).end();
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, version }));
        return;
      }
      if (this.web.handle(req, res)) return;
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
        const id = `local-${String(++this.seq)}`;
        const conn = new Connection(
          id,
          {
            send: (text) => {
              if (ws.readyState === ws.OPEN) ws.send(text);
            },
            close: (reason) => {
              ws.close(1008, reason);
            },
          },
          this.bus,
          this.router,
          this.log,
        );
        ws.on("message", (raw: Buffer) => {
          void conn.receive(raw.toString());
        });
        ws.on("close", () => {
          conn.dispose();
        });
        // Oversized or malformed frames surface here; without a listener they would crash the daemon.
        ws.on("error", (e) => {
          this.log.warn({ conn: id, code: e.name }, "websocket error");
        });
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
    const ownOrigin = this.allowedHosts().some((h) => origin === `http://${h}`);
    if (origin !== undefined && !ownOrigin && !this.devOrigins.includes(origin)) return "origin";
    const header = req.headers.authorization?.replace(/^Bearer /, "");
    const fromProtocol = (req.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX))
      ?.slice(TOKEN_PROTOCOL_PREFIX.length);
    const given = header ?? fromProtocol ?? "";
    return safeEqual(given, this.token) ? null : "token";
  }

  /** The desktop web UI's URL with a one-time code, or null when no web build is configured. */
  webLink(): string | null {
    if (!this.web.enabled) return null;
    return `http://127.0.0.1:${String(this.port)}/#code=${this.web.issueCode()}`;
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
