import { webSocketAccept } from "@agentdeck/crypto";

/** The largest request the local preview server takes (a dev page's form posts are small). */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const CRLF2 = [13, 10, 13, 10];
const enc = new TextEncoder();
const dec = new TextDecoder();

export type TLocalRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function indexOfSeq(buf: Uint8Array, seq: readonly number[]): number {
  outer: for (let i = 0; i + seq.length <= buf.length; i++) {
    for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * HTTP/1.1 requests from a browser on one connection, as bytes arrive: the head, then
 * `Content-Length` bytes of body (pages don't send chunked requests to a dev server).
 */
export class HttpRequestParser {
  private buf: Uint8Array = new Uint8Array(0);

  /** New bytes in; every request now complete out. Throws on a malformed or oversized request. */
  push(bytes: Uint8Array): TLocalRequest[] {
    this.buf = concat(this.buf, bytes);
    if (this.buf.length > MAX_REQUEST_BYTES) throw new Error("request too large");
    const out: TLocalRequest[] = [];
    for (;;) {
      const end = indexOfSeq(this.buf, CRLF2);
      if (end < 0) return out;
      const [line = "", ...lines] = dec.decode(this.buf.subarray(0, end)).split("\r\n");
      const [method, path] = line.split(" ");
      if (!method || !path?.startsWith("/")) throw new Error("bad request line");
      const headers: Record<string, string> = {};
      for (const l of lines) {
        const i = l.indexOf(":");
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      const length = Number(headers["content-length"] ?? "0");
      if (!Number.isInteger(length) || length < 0) throw new Error("bad content-length");
      const start = end + 4;
      if (this.buf.length < start + length) return out;
      out.push({ method, path, headers, body: this.buf.slice(start, start + length) });
      this.buf = this.buf.slice(start + length);
    }
  }
}

const REASONS: Readonly<Record<number, string>> = {
  101: "Switching Protocols",
  200: "OK",
  204: "No Content",
  304: "Not Modified",
  400: "Bad Request",
  404: "Not Found",
  500: "Internal Server Error",
  502: "Bad Gateway",
};

/** A complete response; the connection then closes (no keep-alive, so framing stays simple). */
export function httpResponse(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: Uint8Array,
): Uint8Array {
  const lines = [`HTTP/1.1 ${String(status)} ${REASONS[status] ?? "Status"}`];
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (key === "content-length" || key === "connection" || key === "transfer-encoding") continue;
    lines.push(`${k}: ${v}`);
  }
  lines.push(`content-length: ${String(body.length)}`, "connection: close", "", "");
  return concat(enc.encode(lines.join("\r\n")), body);
}

/** Whether a request asks to become a WebSocket. */
export function isUpgrade(req: TLocalRequest): boolean {
  return (
    (req.headers["upgrade"] ?? "").toLowerCase() === "websocket" &&
    req.headers["sec-websocket-key"] !== undefined
  );
}

/** The 101 answer to a WebSocket upgrade, keeping the first subprotocol the page asked for. */
export function upgradeResponse(req: TLocalRequest): Uint8Array {
  const protocol = (req.headers["sec-websocket-protocol"] ?? "").split(",")[0]?.trim() ?? "";
  const lines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${webSocketAccept(req.headers["sec-websocket-key"] ?? "")}`,
    ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
    "",
    "",
  ];
  return enc.encode(lines.join("\r\n"));
}

export const WS_TEXT = 1;
export const WS_BINARY = 2;
export const WS_CLOSE = 8;
export const WS_PING = 9;
export const WS_PONG = 10;

export type TWsFrame = { opcode: number; payload: Uint8Array };

/** Frames from a browser (masked, RFC 6455), as bytes arrive. Fragments are joined. */
export class WsFrameParser {
  private buf: Uint8Array = new Uint8Array(0);
  private fragments: Uint8Array[] = [];
  private fragmentOp = 0;

  push(bytes: Uint8Array): TWsFrame[] {
    this.buf = concat(this.buf, bytes);
    const out: TWsFrame[] = [];
    for (;;) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      if (b0 === undefined || b1 === undefined) return out;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) return out;
        len = ((this.buf[2] ?? 0) << 8) | (this.buf[3] ?? 0);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return out;
        len = 0;
        for (let i = 2; i < 10; i++) len = len * 256 + (this.buf[i] ?? 0);
        at = 10;
      }
      const masked = (b1 & 0x80) !== 0;
      const mask = masked ? this.buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (len > MAX_REQUEST_BYTES) throw new Error("frame too large");
      if (this.buf.length < at + len) return out;
      const payload = this.buf.slice(at, at + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
      this.buf = this.buf.slice(at + len);
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      if (opcode >= 8) {
        out.push({ opcode, payload });
        continue;
      }
      if (opcode !== 0) this.fragmentOp = opcode;
      this.fragments.push(payload);
      if (!fin) continue;
      const whole = this.fragments.reduce(concat, new Uint8Array(0));
      out.push({ opcode: this.fragmentOp, payload: whole });
      this.fragments = [];
    }
  }
}

/** One unmasked frame from the server side. */
export function wsFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const n = payload.length;
  const head =
    n < 126
      ? Uint8Array.of(0x80 | opcode, n)
      : n < 65536
        ? Uint8Array.of(0x80 | opcode, 126, n >> 8, n & 0xff)
        : Uint8Array.of(
            0x80 | opcode,
            127,
            0,
            0,
            0,
            0,
            (n >>> 24) & 0xff,
            (n >>> 16) & 0xff,
            (n >>> 8) & 0xff,
            n & 0xff,
          );
  return concat(head, payload);
}
