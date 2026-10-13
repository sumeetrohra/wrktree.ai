import type { ILocalSocket } from "@/lib/localserver";

import { serveSealed, type ISealedBackend, type TSealedWsEvent } from "./sealed-proxy.utils";

const enc = new TextEncoder();
const dec = new TextDecoder();

function fakeSocket() {
  const written: Uint8Array[] = [];
  let onData: (b: Uint8Array) => void = () => undefined;
  let ended = false;
  const socket: ILocalSocket = {
    write: (b) => written.push(b),
    end: () => {
      ended = true;
    },
    onData: (l) => {
      onData = l;
    },
    onClose: () => undefined,
  };
  return {
    socket,
    send: (text: string | Uint8Array) => {
      onData(typeof text === "string" ? enc.encode(text) : text);
    },
    text: () => written.map((b) => dec.decode(b)).join(""),
    written,
    ended: () => ended,
  };
}

function fakeBackend() {
  const calls: unknown[][] = [];
  let listener: (e: TSealedWsEvent) => void = () => undefined;
  const backend: ISealedBackend = {
    fetch: (req) => {
      calls.push(["fetch", req]);
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "text/html" },
        body: btoa("<h1>sealed</h1>"),
      });
    },
    wsEvents: (wsId, l) => {
      calls.push(["wsEvents", wsId]);
      listener = l;
      return Promise.resolve(() => calls.push(["stop", wsId]));
    },
    wsOpen: (wsId, path, headers) => {
      calls.push(["wsOpen", wsId, path, headers]);
      return Promise.resolve();
    },
    wsSend: (wsId, data, binary) => calls.push(["wsSend", wsId, data, binary]),
    wsClose: (wsId) => calls.push(["wsClose", wsId]),
  };
  return {
    backend,
    calls,
    emit: (e: TSealedWsEvent) => {
      listener(e);
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("serveSealed", () => {
  it("answers a page request with the computer's response, then closes", async () => {
    const s = fakeSocket();
    const b = fakeBackend();
    serveSealed(s.socket, b.backend, () => "pws_x");
    s.send("GET /app.js?v=1 HTTP/1.1\r\nHost: 127.0.0.1:5555\r\nAccept: */*\r\n\r\n");
    await flush();
    expect(b.calls[0]).toEqual(["fetch", { method: "GET", path: "/app.js?v=1", headers: { accept: "*/*" } }]);
    expect(s.text()).toMatch(/^HTTP\/1.1 200 OK\r\ncontent-type: text\/html\r\ncontent-length: 15\r\n/);
    expect(s.text().endsWith("<h1>sealed</h1>")).toBe(true);
    expect(s.ended()).toBe(true);
  });

  it("listens before opening a WebSocket, then relays messages both ways", async () => {
    const s = fakeSocket();
    const b = fakeBackend();
    serveSealed(s.socket, b.backend, () => "pws_abc");
    s.send(
      "GET /hmr HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n",
    );
    await flush();
    expect(b.calls.map((c) => c[0])).toEqual(["wsEvents", "wsOpen"]);
    expect(b.calls[1]).toEqual(["wsOpen", "pws_abc", "/hmr", { "sec-websocket-protocol": "vite-hmr" }]);
    expect(s.text()).toContain("HTTP/1.1 101 Switching Protocols");

    b.emit({ data: "reload", binary: false });
    expect(Array.from(s.written.at(-1) ?? [])).toEqual([0x81, 6, ...enc.encode("reload")]);

    const payload = enc.encode("ping");
    s.send(Uint8Array.of(0x81, 0x80 | payload.length, 0, 0, 0, 0, ...payload));
    expect(b.calls.at(-1)).toEqual(["wsSend", "pws_abc", "ping", false]);

    b.emit({ closed: true });
    expect(b.calls.slice(-2).map((c) => c[0])).toEqual(["stop", "wsClose"]);
    expect(s.ended()).toBe(true);
  });

  it("refuses a malformed request", () => {
    const s = fakeSocket();
    serveSealed(s.socket, fakeBackend().backend, () => "pws_x");
    s.send("nonsense\r\n\r\n");
    expect(s.text()).toMatch(/^HTTP\/1.1 400/);
  });
});
