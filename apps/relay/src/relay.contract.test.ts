import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateIdentity, signRegistration, type TIdentity } from "@agentdeck/crypto";
import {
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  type TDeviceKind,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { silentLogger } from "@agentdeck/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startNodeRelay, type TNodeRelay } from "./app/node-host.js";
import { hostRequest, hostSocket, type THostResponse } from "./infra/node/index.js";
import { relayEnvSchema } from "./shared/relay-env.schema.js";
import { CLOSE, PUSH_MESSAGE } from "./shared/relay.constants.js";

const DEV_SECRET = "test-secret-test-secret-test-secret-123";

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
      env: relayEnvSchema.parse({ RELAY_DEV: "1", RELAY_DEV_SECRET: DEV_SECRET }),
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

  /** A dev ID token, standing in for a Firebase sign-in. */
  async signIn(uid: string): Promise<string> {
    const res = await this.call("GET", `/v1/dev/id-token?uid=${uid}&email=${uid}@example.com`);
    expect(res.status).toBe(200);
    return res.json["idToken"] as string;
  }

  async register(
    id: TIdentity,
    kind: TDeviceKind,
    idToken: string,
    name: string = kind,
  ): Promise<{ deviceId: string; token: string }> {
    const reg = signRegistration(id, Date.now());
    const res = await this.call("POST", "/v1/devices/register", {
      body: { ...reg, kind, name },
      token: idToken,
    });
    expect(res.status).toBe(200);
    return { deviceId: reg.deviceId, token: res.json["deviceToken"] as string };
  }

  /** A computer signs in like any device and registers as a host. */
  linkHost(id: TIdentity, idToken: string, name = "laptop"): Promise<{ deviceId: string; token: string }> {
    return this.register(id, "daemon", idToken, name);
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

/** The `name=value` of a Set-Cookie header. */
const cookieOf = (r: THostResponse): string => {
  const sc = r.headers["set-cookie"];
  return (Array.isArray(sc) ? (sc[0] ?? "") : (sc ?? "")).split(";")[0] ?? "";
};

/** The preview frames a daemon socket received, parsed. */
const previewFrames = (s: Sock): Record<string, unknown>[] =>
  s.frames
    .filter((f) => f["kind"] === "preview" && f["from"] === "relay")
    .map((f) => JSON.parse(String(f["body"])) as Record<string, unknown>);

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

  /** A signed-in phone and a host linked to the same account. */
  async function pairedAccount(uid: string) {
    const idToken = await c.signIn(uid);
    const phoneId = generateIdentity();
    const daemonId = generateIdentity();
    const phone = await c.register(phoneId, "phone", idToken);
    const daemon = await c.linkHost(daemonId, idToken);
    return { idToken, phone, daemon, daemonId, phoneId };
  }

  it("accepts only valid ID tokens", async () => {
    const id = generateIdentity();
    const reg = { ...signRegistration(id, Date.now()), kind: "phone", name: "x" };
    expect((await c.call("POST", "/v1/devices/register", { body: reg })).status).toBe(401);
    const forged = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
    expect((await c.call("POST", "/v1/devices/register", { body: reg, token: forged })).status).toBe(401);
    const idToken = await c.signIn("someone");
    const tampered = idToken.slice(0, -2) + (idToken.endsWith("A") ? "BB" : "AA");
    expect((await c.call("POST", "/v1/devices/register", { body: reg, token: tampered })).status).toBe(401);
    expect((await c.call("POST", "/v1/devices/register", { body: reg, token: idToken })).status).toBe(200);
    expect((await c.call("GET", "/v1/dev/id-token?uid=bad%20uid")).status).toBe(400);
  });

  it("rejects registrations with a bad signature; hosts register like any signed-in device", async () => {
    const idToken = await c.signIn("forger");
    const reg = signRegistration(generateIdentity(), Date.now());
    const forged = await c.call("POST", "/v1/devices/register", {
      token: idToken,
      body: {
        ...reg,
        signPub: signRegistration(generateIdentity(), Date.now()).signPub,
        kind: "phone",
        name: "x",
      },
    });
    expect(forged.status).toBe(401);
    const host = await c.call("POST", "/v1/devices/register", {
      token: idToken,
      body: { ...reg, kind: "daemon", name: "desk" },
    });
    expect(host.status).toBe(200);
    const unsigned = await c.call("POST", "/v1/devices/register", {
      body: { ...reg, kind: "daemon", name: "x" },
    });
    expect(unsigned.status).toBe(401);
  });

  it("serves the public client configuration", async () => {
    const res = await c.call("GET", "/v1/config");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ firebase: null, devSignIn: true });
  });

  it("lists the account's devices with their signing keys, to users and to hosts", async () => {
    const { idToken, phone, daemon, phoneId } = await pairedAccount("lister");
    const asUser = await c.call("GET", "/v1/devices", { token: idToken });
    const asHost = await c.call("GET", "/v1/devices", { token: daemon.token });
    expect(asHost.json).toEqual(asUser.json);
    const devices = asUser.json["devices"] as Record<string, unknown>[];
    expect(devices.map((d) => d["id"]).sort()).toEqual([phone.deviceId, daemon.deviceId].sort());
    expect(devices.find((d) => d["id"] === phone.deviceId)?.["signPub"]).toBe(
      signRegistration(phoneId, 0).signPub,
    );
    // Another account sees none of them.
    const stranger = await c.call("GET", "/v1/devices", { token: await c.signIn("stranger") });
    expect(stranger.json).toEqual({ devices: [] });
  });

  it("forwards frames between paired devices, and only frames whose `from` is the sender", async () => {
    const { phone, daemon } = await pairedAccount("fwd");
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
    const { phone, daemon } = await pairedAccount("offline");
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

  it("removes a device, dropping its socket and token; it may sign in again", async () => {
    const { idToken, phone, daemon, phoneId } = await pairedAccount("remover");
    const other = await c.register(generateIdentity(), "web", idToken);
    // A consumer's device token can't remove other devices; the user's ID token or a host can.
    const denied = await c.call("DELETE", `/v1/devices/${phone.deviceId}`, { token: other.token });
    expect(denied.status).toBe(403);
    const elsewhere = await c.call("DELETE", `/v1/devices/${phone.deviceId}`, {
      token: await c.signIn("not-the-owner"),
    });
    expect(elsewhere.status).toBe(404);
    const p = await c.socket(phone.token);
    const res = await c.call("DELETE", `/v1/devices/${phone.deviceId}`, { token: daemon.token });
    expect(res.status).toBe(200);
    await p.until((s) => s.closeCode !== null);
    expect(p.closeCode).toBe(CLOSE.REVOKED);
    await expect(c.socket(phone.token)).rejects.toThrow();
    expect((await c.call("GET", "/v1/devices/me", { token: phone.token })).status).toBe(401);
    // Removing yourself is logging out.
    expect((await c.call("DELETE", `/v1/devices/${other.deviceId}`, { token: other.token })).status).toBe(
      200,
    );
    await c.register(phoneId, "phone", idToken);
  });

  it("refuses sockets with a bad token or a token in the URL", async () => {
    await expect(c.socket("nope")).rejects.toThrow();
    const { daemon } = await pairedAccount("url");
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
    const { phone, daemon } = await pairedAccount("flood");
    const p = await c.socket(phone.token);
    for (let i = 0; i < 80; i++)
      p.send({ from: phone.deviceId, to: daemon.deviceId, seq: i + 1, kind: "ping" });
    await p.until((s) => s.closeCode !== null);
    expect(p.closeCode).toBe(CLOSE.RATE_LIMIT);
  });
  describe("preview tunnel", () => {
    /** A computer opens a preview for the phone and is online to answer it. */
    async function opened(uid: string) {
      const acct = await pairedAccount(uid);
      const res = await c.call("POST", "/v1/preview", {
        token: acct.daemon.token,
        body: { worktreeId: "wt_1", allowedDeviceId: acct.phone.deviceId },
      });
      expect(res.status).toBe(200);
      const url = new URL(res.json["url"] as string);
      const d = await c.socket(acct.daemon.token);
      const reply = (frame: Record<string, unknown>): void => {
        d.send({
          kind: "preview",
          to: "relay",
          from: acct.daemon.deviceId,
          seq: 0,
          body: JSON.stringify(frame),
        });
      };
      return { ...acct, res, url, host: url.host, key: res.json["key"] as string, d, reply };
    }

    it("opens only for a computer, for a device on its account", async () => {
      const { daemon, phone, res, url, idToken } = await opened("prev-open");
      expect(url.hostname).toBe(`${String(res.json["token"])}.preview.localhost`);
      expect(url.port).toBe(new URL(c.url).port);
      expect(res.json["expiresAt"]).toBeGreaterThan(Date.now());
      const asPhone = await c.call("POST", "/v1/preview", {
        token: phone.token,
        body: { worktreeId: "wt_1", allowedDeviceId: phone.deviceId },
      });
      expect(asPhone.status).toBe(403);
      const stranger = await c.register(generateIdentity(), "phone", await c.signIn("prev-stranger"));
      const foreign = await c.call("POST", "/v1/preview", {
        token: daemon.token,
        body: { worktreeId: "wt_1", allowedDeviceId: stranger.deviceId },
      });
      expect(foreign.status).toBe(403);
      expect((await c.call("POST", "/v1/preview", { token: idToken, body: {} })).status).toBe(401);
    });

    it("trades the one-time key for a cookie, and refuses requests without it", async () => {
      const t = await opened("prev-key");
      expect((await hostRequest(c.url, t.host, "/")).status).toBe(403);
      expect((await hostRequest(c.url, t.host, "/?k=wrong")).status).toBe(403);
      const first = await hostRequest(c.url, t.host, `/app?x=1&k=${t.key}`);
      expect(first.status).toBe(302);
      expect(first.headers["location"]).toBe("/app?x=1");
      const setCookie = String(first.headers["set-cookie"]);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect((await hostRequest(c.url, t.host, `/?k=${t.key}`)).status).toBe(403); // used up
      // Another preview's cookie opens nothing here.
      const other = await opened("prev-key-2");
      const otherCookie = cookieOf(await hostRequest(c.url, other.host, `/?k=${other.key}`));
      expect((await hostRequest(c.url, t.host, "/", { cookie: otherCookie })).status).toBe(403);
      t.d.close();
      other.d.close();
    });

    it("forwards requests to the computer and streams its response back", async () => {
      const t = await opened("prev-fwd");
      const cookie = cookieOf(await hostRequest(c.url, t.host, `/?k=${t.key}`));
      const pending = hostRequest(c.url, t.host, "/index.html?v=2", { cookie, accept: "text/html" });
      await t.d.until((s) => previewFrames(s).some((f) => f["t"] === "req"));
      const req = previewFrames(t.d).find((f) => f["t"] === "req") ?? {};
      expect(req).toMatchObject({
        method: "GET",
        path: "/index.html?v=2",
        token: t.url.hostname.split(".")[0],
      });
      const headers = req["headers"] as Record<string, string>;
      expect(headers["accept"]).toBe("text/html");
      expect(headers["cookie"]).toBeUndefined(); // the relay's cookie stays at the relay
      expect(headers["host"]).toBeUndefined();
      const id = String(req["id"]);
      t.reply({ t: "head", id, status: 200, headers: { "content-type": "text/plain", "set-cookie": "x=1" } });
      t.reply({ t: "chunk", id, data: btoa("hello "), last: false });
      t.reply({ t: "chunk", id, data: btoa("world"), last: true });
      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.body).toBe("hello world");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["set-cookie"]).toBeUndefined();
      t.d.close();
    });

    it("answers 502 when the computer is offline, and the computer's own errors as is", async () => {
      const t = await opened("prev-off");
      const cookie = cookieOf(await hostRequest(c.url, t.host, `/?k=${t.key}`));
      const pending = hostRequest(c.url, t.host, "/", { cookie });
      await t.d.until((s) => previewFrames(s).some((f) => f["t"] === "req"));
      const id = String(previewFrames(t.d).find((f) => f["t"] === "req")?.["id"]);
      t.reply({ t: "error", id, status: 502, message: "dev server is not running" });
      const res = await pending;
      expect(res.status).toBe(502);
      expect(res.body).toBe("dev server is not running");
      t.d.close();
      await t.d.until((s) => s.closeCode !== null);
      await new Promise((r) => setTimeout(r, 200));
      expect((await hostRequest(c.url, t.host, "/", { cookie })).status).toBe(502);
    });

    it("bridges WebSockets both ways", async () => {
      const t = await opened("prev-ws");
      const cookie = cookieOf(await hostRequest(c.url, t.host, `/?k=${t.key}`));
      await expect(hostSocket(c.url, t.host, "/hmr")).rejects.toThrow();
      const ws = await hostSocket(c.url, t.host, "/hmr", { cookie }, ["vite-hmr"]);
      await t.d.until((s) => previewFrames(s).some((f) => f["t"] === "wsOpen"));
      const open = previewFrames(t.d).find((f) => f["t"] === "wsOpen") ?? {};
      expect(open["path"]).toBe("/hmr");
      expect(open["headers"]).toMatchObject({ "sec-websocket-protocol": "vite-hmr" });
      expect(open["headers"]).not.toHaveProperty("cookie");
      const id = String(open["id"]);
      t.reply({ t: "wsData", id, data: "reload", binary: false });
      await t.d.until(() => ws.received.includes("reload"));
      ws.send("hello from the page");
      await t.d.until((s) =>
        previewFrames(s).some((f) => f["t"] === "wsData" && f["data"] === "hello from the page"),
      );
      ws.close();
      await t.d.until((s) => previewFrames(s).some((f) => f["t"] === "wsClose" && f["id"] === id));
      t.d.close();
    });

    it("closes a preview: its cookie opens nothing after", async () => {
      const t = await opened("prev-close");
      const cookie = cookieOf(await hostRequest(c.url, t.host, `/?k=${t.key}`));
      const token = t.url.hostname.split(".")[0] ?? "";
      expect((await c.call("DELETE", `/v1/preview/${token}`, { token: t.daemon.token })).status).toBe(200);
      expect((await hostRequest(c.url, t.host, "/", { cookie })).status).toBe(403);
      t.d.close();
    });
  });
});
