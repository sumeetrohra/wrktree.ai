import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { RELAY_WS_PROTOCOL } from "@agentdeck/protocol";
import { getRequestListener } from "@hono/node-server";
import { WebSocketServer } from "ws";

import { RELAY_LIMITS } from "#src/shared/relay.constants.js";
import { socketToken } from "#src/shared/socket-token.utils.js";

/** One relay WebSocket, as the hub sees it. */
export interface IRelaySocket {
  send(text: string): void;
  close(code: number, reason: string): void;
  onMessage(fn: (text: string) => void): void;
  onClose(fn: () => void): void;
}

/** A browser's WebSocket to a preview host, bridged to the dev server (Phase 3c). */
export interface IPreviewWire {
  send(data: string | Uint8Array): void;
  close(code: number): void;
  onMessage(fn: (data: string | Uint8Array) => void): void;
  onClose(fn: () => void): void;
}

export type TServeOptions = {
  fetch: (req: Request) => Response | Promise<Response>;
  port: number;
  host: string;
  authenticate(
    token: string | null,
    deviceParam: string | null,
  ): Promise<{ deviceId: string; accountId: string } | null>;
  onSocket(auth: { deviceId: string; accountId: string }, socket: IRelaySocket): void;
  /** Phase 3c: WebSocket upgrades on preview hosts. */
  preview?: {
    /** The preview token for a `Host`, or null when it isn't a preview host. */
    tokenOf(host: string | undefined): string | null;
    /** After checking the cookie: what to do with the open socket, or null (403). */
    accept(
      token: string,
      cookie: string | undefined,
      path: string,
      headers: Headers,
    ): Promise<((wire: IPreviewWire) => void) | null>;
  };
};

function reject(socket: Duplex, status: number): void {
  const reason = status === 403 ? "Forbidden" : status === 400 ? "Bad Request" : "Unauthorized";
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/** Self-host HTTP server: Hono for the API, `ws` for `/v1/ws` upgrades. */
export async function serveRelay(opts: TServeOptions): Promise<{ port: number; close(): Promise<void> }> {
  const listener = getRequestListener(opts.fetch);
  const server = createServer((req, res) => {
    void listener(req, res);
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: RELAY_LIMITS.frameBytes,
    handleProtocols: (protocols) => (protocols.has(RELAY_WS_PROTOCOL) ? RELAY_WS_PROTOCOL : false),
  });
  const previewWss = new WebSocketServer({
    noServer: true,
    maxPayload: RELAY_LIMITS.frameBytes / 2,
    handleProtocols: (protocols) => protocols.values().next().value ?? false,
  });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const previewToken = opts.preview?.tokenOf(req.headers.host) ?? null;
    if (opts.preview && previewToken !== null) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      void opts.preview
        .accept(previewToken, req.headers.cookie, url.pathname + url.search, headers)
        .then((bridge) => {
          if (!bridge) {
            reject(socket, 403);
            return;
          }
          previewWss.handleUpgrade(req, socket, head, (ws) => {
            ws.on("error", () => undefined);
            bridge({
              send: (data) => {
                if (ws.readyState === ws.OPEN) ws.send(data);
              },
              close: (code) => {
                ws.close(code);
              },
              onMessage: (fn) => {
                ws.on("message", (raw: Buffer, isBinary: boolean) => {
                  fn(isBinary ? new Uint8Array(raw) : raw.toString());
                });
              },
              onClose: (fn) => {
                ws.on("close", fn);
              },
            });
          });
        });
      return;
    }
    if (url.pathname !== "/v1/ws" || url.searchParams.has("token")) {
      reject(socket, 400);
      return;
    }
    const token = socketToken(req.headers.authorization, req.headers["sec-websocket-protocol"]);
    void opts.authenticate(token, url.searchParams.get("device")).then((auth) => {
      if (!auth) {
        reject(socket, 401);
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("error", () => undefined); // oversized frames surface here; never crash the relay
        opts.onSocket(auth, {
          send: (text) => {
            if (ws.readyState === ws.OPEN) ws.send(text);
          },
          close: (code, reason) => {
            ws.close(code, reason);
          },
          onMessage: (fn) => {
            ws.on("message", (raw: Buffer) => {
              fn(raw.toString());
            });
          },
          onClose: (fn) => {
            ws.on("close", fn);
          },
        });
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(opts.port, opts.host, resolve);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? (addr satisfies AddressInfo).port : opts.port;
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        for (const c of previewWss.clients) c.terminate();
        server.close(() => {
          resolve();
        });
      }),
  };
}
