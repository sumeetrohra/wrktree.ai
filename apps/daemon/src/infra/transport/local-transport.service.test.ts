import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandNames } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { EventBus } from "../bus/index.js";
import { openDb } from "../db/index.js";
import { Router, type THandlers } from "../rpc/index.js";

import { LocalTransport } from "./local-transport.service.js";
import { LIMITS, TOKEN_PROTOCOL_PREFIX } from "./transport.constants.js";

function handlers(): THandlers {
  const all: Record<string, unknown> = Object.fromEntries(commandNames.map((n) => [n, () => ({})]));
  return { ...all, "repo.list": () => [] } as unknown as THandlers;
}

let transport: LocalTransport;
let router: Router;
let port: number;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "transport-"));
  const db = openDb(join(dir, "db"));
  router = new Router(db, handlers(), silentLogger);
  transport = new LocalTransport(new EventBus(join(dir, "events"), db), router, silentLogger, "test");
  port = await transport.listen(0);
});

afterEach(async () => {
  await transport.close();
  router.close();
});

/** Resolves "open" or the HTTP status the server refused with. */
function attempt(
  path: string,
  opts: { headers?: Record<string, string>; protocols?: string[] } = {},
): Promise<{ ws: WebSocket; result: "open" | number }> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, opts.protocols ?? [], {
    headers: opts.headers ?? {},
  });
  return new Promise((resolve) => {
    ws.once("open", () => {
      resolve({ ws, result: "open" });
    });
    ws.once("unexpected-response", (_req, res) => {
      resolve({ ws, result: res.statusCode ?? 0 });
    });
    ws.once("error", () => {
      resolve({ ws, result: 0 });
    });
  });
}

const auth = (): Record<string, string> => ({ authorization: `Bearer ${transport.token}` });

describe("LocalTransport upgrade checks (SEC3, SEC4)", () => {
  it("accepts the token in the Authorization header", async () => {
    const { ws, result } = await attempt("/v1/ws", { headers: auth() });
    expect(result).toBe("open");
    ws.close();
  });

  it("accepts the token as a subprotocol (browsers can't set headers)", async () => {
    const { ws, result } = await attempt("/v1/ws", {
      protocols: ["agentdeck.v1", `${TOKEN_PROTOCOL_PREFIX}${transport.token}`],
    });
    expect(result).toBe("open");
    ws.close();
  });

  it("rejects a missing or wrong token", async () => {
    expect((await attempt("/v1/ws")).result).toBe(401);
    expect((await attempt("/v1/ws", { headers: { authorization: "Bearer nope" } })).result).toBe(401);
  });

  it("rejects a token in the URL even when it is correct", async () => {
    expect((await attempt(`/v1/ws?token=${transport.token}`, { headers: auth() })).result).toBe(401);
  });

  it("rejects a foreign Origin (drive-by website)", async () => {
    const { result } = await attempt("/v1/ws", { headers: { ...auth(), origin: "https://evil.example" } });
    expect(result).toBe(401);
  });

  it("accepts the daemon's own Origin", async () => {
    const { ws, result } = await attempt("/v1/ws", {
      headers: { ...auth(), origin: `http://127.0.0.1:${String(port)}` },
    });
    expect(result).toBe("open");
    ws.close();
  });

  it("rejects a Host that isn't this listener (DNS rebinding)", async () => {
    const { result } = await attempt("/v1/ws", {
      headers: { ...auth(), host: `evil.example:${String(port)}` },
    });
    expect(result).toBe(401);
  });
});

describe("LocalTransport limits (SEC9)", () => {
  const closed = (ws: WebSocket): Promise<number> =>
    new Promise((resolve) => {
      ws.once("close", (code) => {
        resolve(code);
      });
    });

  it("closes a connection that floods frames", async () => {
    const { ws } = await attempt("/v1/ws", { headers: auth() });
    const done = closed(ws);
    for (let i = 0; i <= LIMITS.framesPerSecond + 10; i++) {
      ws.send(JSON.stringify({ t: "cmd", id: newId("cmd"), name: "repo.list", args: {} }));
    }
    expect(await done).toBe(1008);
  });

  it("closes a connection that sends an oversized frame, and keeps serving others", async () => {
    const { ws } = await attempt("/v1/ws", { headers: auth() });
    const done = closed(ws);
    ws.send("x".repeat(LIMITS.frameBytes + 1));
    expect(await done).toBe(1009);
    const other = await attempt("/v1/ws", { headers: auth() });
    expect(other.result).toBe("open");
    other.ws.close();
  });

  it("closes a connection whose upload exceeds the cap", async () => {
    const { ws } = await attempt("/v1/ws", { headers: auth() });
    const done = closed(ws);
    const PART = 600 * 1024;
    const part = Buffer.alloc(PART, 1).toString("base64");
    const blobId = newId("up");
    const parts = Math.ceil(LIMITS.uploadBytes / PART) + 1;
    let i = 0;
    const timer = setInterval(() => {
      // Spread over time so the frame-rate limit isn't what trips.
      if (i >= parts || ws.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        return;
      }
      ws.send(JSON.stringify({ t: "blob", blobId, part: i, last: false, bytes: part }));
      i++;
    }, 1);
    expect(await done).toBe(1008);
    clearInterval(timer);
  }, 30_000);
});
