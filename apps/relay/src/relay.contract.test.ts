import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateIdentity, signRegistration, signRevocation, type TIdentity } from "@agentdeck/crypto";
import {
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  type TDeviceKind,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { silentLogger } from "@agentdeck/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startNodeRelay, type TNodeRelay } from "./app/node-host.js";
import { relayEnvSchema } from "./shared/relay-env.schema.js";
import { CLOSE, PUSH_MESSAGE } from "./shared/relay.constants.js";

const JWT_SECRET = "test-secret-test-secret-test-secret-123";

type THost = { name: string; start(): Promise<{ url: string; stop(): Promise<void> }> };

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => {
        resolve(port);
      });
    });
  });

const nodeHost: THost = {
  name: "node (self-host)",
  async start() {
    const relay: TNodeRelay = await startNodeRelay({
      port: 0,
      dataDir: mkdtempSync(join(tmpdir(), "relay-")),
      env: relayEnvSchema.parse({ RELAY_DEV: "1", RELAY_JWT_SECRET: JWT_SECRET }),
      log: silentLogger,
    });
    return { url: relay.url, stop: () => relay.close() };
  },
};

/** The Worker build under `wrangler dev` (workerd + Durable Objects), fresh state per run. */
const workerHost: THost = {
  name: "worker (Durable Objects)",
  async start() {
    const port = await freePort();
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const child: ChildProcess = spawn(
      "npx",
      [
        "wrangler",
        "dev",
        "--env",
        "dev",
        "--port",
        String(port),
        "--ip",
        "127.0.0.1",
        "--persist-to",
        mkdtempSync(join(tmpdir(), "wr-")),
      ],
      {
        cwd,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
        // Its own process group, so stopping it also stops workerd and esbuild.
        detached: process.platform !== "win32",
      },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("wrangler dev did not start"));
      }, 90_000);
      child.stdout?.on("data", (d: Buffer) => {
        if (d.toString().includes("Ready on")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    return {
      url: `http://127.0.0.1:${String(port)}`,
      stop: () =>
        new Promise((resolve) => {
          child.once("exit", () => {
            resolve();
          });
          if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        }),
    };
  },
};

const HOSTS = process.env["RELAY_WORKER_TESTS"] === "1" ? [nodeHost, workerHost] : [nodeHost];

class Client {
  constructor(readonly url: string) {}

  async call(
    method: string,
    path: string,
    opts: { body?: unknown; token?: string } = {},
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(this.url + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  async signIn(email: string): Promise<string> {
    await this.call("POST", "/v1/auth/start", { body: { email } });
    const { json } = await this.call("GET", "/v1/dev/outbox");
    const mine = (json["messages"] as { to: string; code: string }[]).filter((m) => m.to === email).at(-1);
    const fin = await this.call("POST", "/v1/auth/finish", { body: { email, code: mine?.code } });
    expect(fin.status).toBe(200);
    return fin.json["sessionToken"] as string;
  }

  async register(
    id: TIdentity,
    kind: TDeviceKind,
    session?: string,
  ): Promise<{ deviceId: string; token: string }> {
    const reg = signRegistration(id, Date.now());
    const res = await this.call("POST", "/v1/devices/register", {
      body: { ...reg, kind, name: kind },
      ...(session === undefined ? {} : { token: session }),
    });
    expect(res.status).toBe(200);
    return { deviceId: reg.deviceId, token: res.json["deviceToken"] as string };
  }

  socket(token: string): Promise<Sock> {
    return Sock.open(this.url.replace(/^http/, "ws") + "/v1/ws", token);
  }
}

/** A device's relay socket, recording what arrives. */
class Sock {
  readonly frames: Record<string, unknown>[] = [];
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const frame = JSON.parse(String(e.data)) as Record<string, unknown>;
      this.frames.push(frame);
      if (frame["t"] === "relay.closed") {
        this.closeCode = frame["code"] as number;
        ws.close();
      }
      this.wake();
    });
    ws.addEventListener("close", (e) => {
      this.closeCode ??= e.code;
      this.wake();
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  static open(url: string, token: string): Promise<Sock> {
    const ws = new WebSocket(url, [RELAY_WS_PROTOCOL, RELAY_TOKEN_PROTOCOL_PREFIX + token]);
    const s = new Sock(ws);
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => {
        resolve(s);
      });
      ws.addEventListener("error", () => {
        reject(new Error("socket refused"));
      });
    });
  }

  send(frame: Partial<TRelayFrame> & Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, seq: 1, kind: "msg", body: "c2VhbGVk", ...frame }));
  }

  raw(text: string): void {
    this.ws.send(text);
  }

  async until(pred: (s: Sock) => boolean, ms = 5000): Promise<void> {
    const end = Date.now() + ms;
    while (!pred(this)) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

describe.each(HOSTS)("relay contract: $name", (host) => {
  let relay: { url: string; stop(): Promise<void> };
  let c: Client;

  beforeAll(async () => {
    relay = await host.start();
    c = new Client(relay.url);
  }, 120_000);

  afterAll(async () => {
    await relay.stop();
  });

  /** A signed-in phone and a daemon paired onto its account. */
  async function pairedAccount(email: string) {
    const session = await c.signIn(email);
    const phoneId = generateIdentity();
    const daemonId = generateIdentity();
    const phone = await c.register(phoneId, "phone", session);
    const daemon = await c.register(daemonId, "daemon");
    const offer = await c.call("POST", "/v1/pair/offer", { token: daemon.token });
    expect(offer.status).toBe(200);
    const claim = await c.call("POST", "/v1/pair/claim", {
      token: session,
      body: { pairingId: offer.json["pairingId"], phoneDeviceId: phone.deviceId },
    });
    expect(claim.json).toEqual({ daemonDeviceId: daemon.deviceId });
    return { session, phone, daemon, daemonId, phoneId, pairingId: offer.json["pairingId"] as string };
  }

  it("signs in with a magic-link code and rejects a wrong one", async () => {
    await c.call("POST", "/v1/auth/start", { body: { email: "wrong@example.com" } });
    const bad = await c.call("POST", "/v1/auth/finish", {
      body: { email: "wrong@example.com", code: "000000" },
    });
    expect(bad.status).toBe(401);
    const token = await c.signIn("someone@example.com");
    const refreshed = await c.call("POST", "/v1/auth/refresh", { token });
    expect(refreshed.status).toBe(200);
  });

  it("signs in with (dev) GitHub OAuth, and refuses a forged state", async () => {
    const start = await c.call("POST", "/v1/auth/github/start");
    const ok = await c.call("POST", "/v1/auth/github/finish", {
      body: { code: "dev-octocat", state: start.json["state"] },
    });
    expect(ok.status).toBe(200);
    const forged = await c.call("POST", "/v1/auth/github/finish", {
      body: { code: "dev-octocat", state: "x.y.z" },
    });
    expect(forged.status).toBe(401);
  });

  it("rejects registrations with a bad signature, and phones without an account", async () => {
    const id = generateIdentity();
    const reg = signRegistration(id, Date.now());
    const forged = await c.call("POST", "/v1/devices/register", {
      body: {
        ...reg,
        signPub: signRegistration(generateIdentity(), Date.now()).signPub,
        kind: "daemon",
        name: "x",
      },
    });
    expect(forged.status).toBe(401);
    const noAccount = await c.call("POST", "/v1/devices/register", {
      body: { ...reg, kind: "phone", name: "x" },
    });
    expect(noAccount.status).toBe(401);
  });

  it("pairs once: a used or unknown pairing id is refused", async () => {
    const { session, phone, pairingId } = await pairedAccount("pair@example.com");
    const again = await c.call("POST", "/v1/pair/claim", {
      token: session,
      body: { pairingId, phoneDeviceId: phone.deviceId },
    });
    expect(again.status).toBe(409);
    const unknown = await c.call("POST", "/v1/pair/claim", {
      token: session,
      body: { pairingId: "pair_nope", phoneDeviceId: phone.deviceId },
    });
    expect(unknown.status).toBe(410);
    const list = await c.call("GET", "/v1/devices", { token: session });
    expect((list.json["devices"] as unknown[]).length).toBe(2);
  });

  it("forwards frames between paired devices, and only frames whose `from` is the sender", async () => {
    const { phone, daemon } = await pairedAccount("fwd@example.com");
    const p = await c.socket(phone.token);
    const d = await c.socket(daemon.token);
    p.send({ from: phone.deviceId, to: daemon.deviceId, seq: 1, sid: "s1" });
    await d.until((s) => s.frames.some((f) => f["seq"] === 1 && f["from"] === phone.deviceId));
    p.send({ from: daemon.deviceId, to: daemon.deviceId, seq: 2 }); // spoofed sender: dropped
    p.send({ from: phone.deviceId, to: "d_stranger", seq: 3 });
    await p.until((s) => s.frames.some((f) => f["t"] === "relay.undeliverable"));
    d.send({ from: daemon.deviceId, to: phone.deviceId, seq: 1, sid: "s1" });
    await p.until((s) => s.frames.some((f) => f["from"] === daemon.deviceId));
    expect(d.frames.some((f) => f["seq"] === 2)).toBe(false);
    p.close();
    d.close();
  });

  it("stores frames for an offline phone, push-wakes it once with no content, and deletes on ack", async () => {
    const { phone, daemon } = await pairedAccount("offline@example.com");
    await c.call("POST", "/v1/push/register", {
      token: phone.token,
      body: { expoPushToken: "ExponentPushToken[test]" },
    });
    const d = await c.socket(daemon.token);
    d.send({ from: daemon.deviceId, to: phone.deviceId, seq: 1, sid: "s1", wake: true });
    d.send({ from: daemon.deviceId, to: phone.deviceId, seq: 2, sid: "s1", wake: true });
    await new Promise((r) => setTimeout(r, 300));
    const pushes = (await c.call("GET", "/v1/dev/pushes")).json["pushes"] as Record<string, unknown>[];
    const mine = pushes.filter((p) => p["deviceId"] === phone.deviceId);
    expect(mine).toHaveLength(1); // a second wake within 30 s is coalesced
    expect(mine[0]).toMatchObject({ title: PUSH_MESSAGE.title, body: PUSH_MESSAGE.body });

    const p1 = await c.socket(phone.token);
    await p1.until((s) => s.frames.filter((f) => f["from"] === daemon.deviceId).length === 2);
    p1.send({ from: phone.deviceId, to: daemon.deviceId, kind: "ack", seq: 1, sid: "s1" });
    await new Promise((r) => setTimeout(r, 200));
    p1.close();
    await p1.until((s) => s.closeCode !== null);
    const p2 = await c.socket(phone.token);
    await p2.until((s) => s.frames.some((f) => f["from"] === daemon.deviceId));
    expect(p2.frames.filter((f) => f["from"] === daemon.deviceId).map((f) => f["seq"])).toEqual([2]);
    p2.close();
    d.close();
  });

  it("revokes a device only with a daemon's signature, then drops and locks it out", async () => {
    const { session, phone, daemon, daemonId } = await pairedAccount("revoke@example.com");
    const p = await c.socket(phone.token);
    const at = Date.now();
    const forged = await c.call("DELETE", `/v1/devices/${phone.deviceId}`, {
      token: session,
      body: {
        daemonDeviceId: daemon.deviceId,
        at,
        sig: signRevocation(generateIdentity(), phone.deviceId, at),
      },
    });
    expect(forged.status).toBe(403);
    const res = await c.call("DELETE", `/v1/devices/${phone.deviceId}`, {
      token: session,
      body: { daemonDeviceId: daemon.deviceId, at, sig: signRevocation(daemonId, phone.deviceId, at) },
    });
    expect(res.status).toBe(200);
    await p.until((s) => s.closeCode !== null);
    expect(p.closeCode).toBe(CLOSE.REVOKED);
    await expect(c.socket(phone.token)).rejects.toThrow();
  });

  it("refuses sockets with a bad token or a token in the URL", async () => {
    await expect(c.socket("nope")).rejects.toThrow();
    const { daemon } = await pairedAccount("url@example.com");
    const ws = new WebSocket(`${c.url.replace(/^http/, "ws")}/v1/ws?token=${daemon.token}`, [
      RELAY_WS_PROTOCOL,
    ]);
    await new Promise<void>((resolve) => {
      ws.addEventListener("error", () => {
        resolve();
      });
      ws.addEventListener("open", () => {
        throw new Error("should not open");
      });
    });
  });

  it("closes a phone that floods frames", async () => {
    const { phone, daemon } = await pairedAccount("flood@example.com");
    const p = await c.socket(phone.token);
    for (let i = 0; i < 80; i++)
      p.send({ from: phone.deviceId, to: daemon.deviceId, seq: i + 1, kind: "ping" });
    await p.until((s) => s.closeCode !== null);
    expect(p.closeCode).toBe(CLOSE.RATE_LIMIT);
  });
});
