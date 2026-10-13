import {
  HttpRequestParser,
  httpResponse,
  isUpgrade,
  upgradeResponse,
  WS_BINARY,
  WS_PING,
  WS_TEXT,
  wsFrame,
  WsFrameParser,
} from "./local-http.utils";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A frame as a browser sends it: masked. */
function clientFrame(opcode: number, text: string, fin = true): Uint8Array {
  const payload = enc.encode(text);
  const mask = Uint8Array.of(1, 2, 3, 4);
  const masked = payload.map((b, i) => b ^ (mask[i % 4] ?? 0));
  return Uint8Array.of((fin ? 0x80 : 0) | opcode, 0x80 | payload.length, ...mask, ...masked);
}

describe("HttpRequestParser", () => {
  it("parses requests split across packets, with and without a body, back to back", () => {
    const p = new HttpRequestParser();
    expect(p.push(enc.encode("GET /index.html HTTP/1.1\r\nHost: 127.0.0.1\r\nAc"))).toEqual([]);
    const [get] = p.push(
      enc.encode("cept: text/html\r\n\r\nPOST /api HTTP/1.1\r\nContent-Length: 5\r\n\r\nhel"),
    );
    expect(get).toMatchObject({
      method: "GET",
      path: "/index.html",
      headers: { host: "127.0.0.1", accept: "text/html" },
    });
    const [post] = p.push(enc.encode("lo"));
    expect(post?.method).toBe("POST");
    expect(dec.decode(post?.body)).toBe("hello");
  });

  it("refuses what isn't a request", () => {
    expect(() => new HttpRequestParser().push(enc.encode("hello there\r\n\r\n"))).toThrow(/bad request line/);
  });
});

describe("responses", () => {
  it("sets the length and closes; drops the dev server's own framing headers", () => {
    const text = dec.decode(
      httpResponse(
        200,
        { "content-type": "text/html", "transfer-encoding": "chunked" },
        enc.encode("<h1>hi</h1>"),
      ),
    );
    expect(text).toBe(
      "HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 11\r\nconnection: close\r\n\r\n<h1>hi</h1>",
    );
  });

  it("accepts a WebSocket upgrade with the page's first subprotocol", () => {
    const [req] = new HttpRequestParser().push(
      enc.encode(
        "GET /hmr HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vite-hmr, other\r\n\r\n",
      ),
    );
    if (!req) throw new Error("no request");
    expect(isUpgrade(req)).toBe(true);
    const text = dec.decode(upgradeResponse(req));
    expect(text).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    expect(text).toContain("Sec-WebSocket-Protocol: vite-hmr\r\n");
  });
});

describe("WebSocket frames", () => {
  it("unmasks the browser's frames, joins fragments, passes control frames through", () => {
    const p = new WsFrameParser();
    const bytes = [
      ...clientFrame(WS_TEXT, "hel", false),
      ...clientFrame(0, "lo"),
      ...clientFrame(WS_PING, ""),
    ];
    const frames = [
      ...p.push(Uint8Array.from(bytes.slice(0, 5))),
      ...p.push(Uint8Array.from(bytes.slice(5))),
    ];
    expect(frames.map((f) => [f.opcode, dec.decode(f.payload)])).toEqual([
      [WS_TEXT, "hello"],
      [WS_PING, ""],
    ]);
  });

  it("writes unmasked frames of every length class", () => {
    expect(Array.from(wsFrame(WS_TEXT, enc.encode("reload")).subarray(0, 2))).toEqual([0x81, 6]);
    expect(Array.from(wsFrame(WS_BINARY, new Uint8Array(300)).subarray(0, 4))).toEqual([0x82, 126, 1, 44]);
    expect(wsFrame(WS_BINARY, new Uint8Array(70_000)).length).toBe(70_010);
  });
});
