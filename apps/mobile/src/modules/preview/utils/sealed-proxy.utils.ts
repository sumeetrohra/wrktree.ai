import type { ILocalSocket } from "@/lib/localserver";

import {
  HttpRequestParser,
  httpResponse,
  isUpgrade,
  upgradeResponse,
  WS_BINARY,
  WS_CLOSE,
  WS_PING,
  WS_PONG,
  WS_TEXT,
  wsFrame,
  WsFrameParser,
} from "./local-http.utils";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export type TSealedWsEvent = {
  data?: string | undefined;
  binary?: boolean | undefined;
  closed?: boolean | undefined;
};

/** The computer's side of a sealed preview, through `preview.fetch` and `preview.ws*`. */
export interface ISealedBackend {
  fetch: (req: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /** Listens for a socket's events (before it is opened: they are live only); returns the stop. */
  wsEvents: (wsId: string, listener: (e: TSealedWsEvent) => void) => Promise<() => void>;
  wsOpen: (wsId: string, path: string, headers: Record<string, string>) => Promise<void>;
  wsSend: (wsId: string, data: string, binary: boolean) => void;
  wsClose: (wsId: string) => void;
}

/** Headers the computer's dev server must not see from the WebView (it sets its own `Host`). */
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

function forwardHeaders(h: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).filter(([k]) => !DROP_REQUEST.has(k)));
}

/**
 * Serves one WebView connection (Phase 5e): each HTTP request becomes a sealed `preview.fetch`, a
 * WebSocket upgrade a sealed socket whose messages travel as `preview.ws` events. Nothing goes
 * through the relay in the clear.
 */
export function serveSealed(socket: ILocalSocket, backend: ISealedBackend, newWsId: () => string): void {
  const http = new HttpRequestParser();
  let ws: { id: string; frames: WsFrameParser; stop: () => void } | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (ws) {
      ws.stop();
      backend.wsClose(ws.id);
    }
    socket.end();
  };
  socket.onClose(close);
  socket.onData((bytes) => {
    if (closed) return;
    if (ws) {
      for (const f of ws.frames.push(bytes)) {
        if (f.opcode === WS_TEXT) backend.wsSend(ws.id, dec.decode(f.payload), false);
        else if (f.opcode === WS_BINARY) backend.wsSend(ws.id, toBase64(f.payload), true);
        else if (f.opcode === WS_PING) socket.write(wsFrame(WS_PONG, f.payload));
        else if (f.opcode === WS_CLOSE) close();
      }
      return;
    }
    let requests;
    try {
      requests = http.push(bytes);
    } catch {
      socket.write(httpResponse(400, {}, enc.encode("Bad request")));
      close();
      return;
    }
    const req = requests[0];
    if (!req) return;
    if (isUpgrade(req)) {
      const id = newWsId();
      const current = { id, frames: new WsFrameParser(), stop: (): void => undefined };
      ws = current;
      void backend
        .wsEvents(id, (e) => {
          if (e.closed) {
            socket.write(wsFrame(WS_CLOSE, new Uint8Array(0)));
            close();
            return;
          }
          if (e.data === undefined) return;
          socket.write(
            e.binary ? wsFrame(WS_BINARY, fromBase64(e.data)) : wsFrame(WS_TEXT, enc.encode(e.data)),
          );
        })
        .then(async (stop) => {
          current.stop = stop;
          await backend.wsOpen(id, req.path, forwardHeaders(req.headers));
          socket.write(upgradeResponse(req));
        })
        .catch(() => {
          socket.write(httpResponse(502, {}, enc.encode("The preview's socket didn't open.")));
          close();
        });
      return;
    }
    backend
      .fetch({
        method: req.method,
        path: req.path,
        headers: forwardHeaders(req.headers),
        ...(req.body.length > 0 ? { body: toBase64(req.body) } : {}),
      })
      .then((res) => {
        socket.write(httpResponse(res.status, res.headers, fromBase64(res.body)));
      })
      .catch((e: unknown) => {
        socket.write(
          httpResponse(
            502,
            { "content-type": "text/plain" },
            enc.encode(e instanceof Error ? e.message : "Preview failed"),
          ),
        );
      })
      .finally(close);
  });
}
