import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { TPreviewFrame } from "@agentdeck/protocol";
import { silentLogger } from "@agentdeck/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { PreviewProxy, waitForPort } from "./preview-proxy.service.js";

const BIG = 600 * 1024;

/** A stand-in dev server: `/` echoes the request, `/big` sends 600 KB, `/hmr` is an HMR socket. */
async function devServer(): Promise<{ port: number; server: Server; wss: WebSocketServer }> {
  const server = createServer((req, res) => {
    if (req.url === "/big") {
      res.end(Buffer.alloc(BIG, 97));
      return;
    }
    const body: Buffer[] = [];
    req.on("data", (c: Buffer) => body.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          host: req.headers.host,
          accept: req.headers.accept,
          body: Buffer.concat(body).toString(),
        }),
      );
    });
  });
  const wss = new WebSocketServer({
    server,
    handleProtocols: (p) => (p.has("vite-hmr") ? "vite-hmr" : false),
  });
  wss.on("connection", (ws, req) => {
    ws.send(`hello ${req.url ?? ""} ${ws.protocol}`);
    ws.on("message", (m: Buffer) => {
      ws.send(`echo ${m.toString()}`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { port, server, wss };
}

function harness(port: number | null) {
  const sent: TPreviewFrame[] = [];
  const proxy = new PreviewProxy(
    (f) => sent.push(f),
    { portOf: (t) => (t === "tok" ? port : null) },
    silentLogger,
  );
  const until = async (pred: () => boolean): Promise<void> => {
    const end = Date.now() + 5000;
    while (!pred()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const body = (id: string): string =>
    Buffer.concat(
      sent.flatMap((f) => (f.t === "chunk" && f.id === id ? [Buffer.from(f.data, "base64")] : [])),
    ).toString();
  const done = (id: string): boolean =>
    sent.some((f) => ((f.t === "chunk" && f.last) || f.t === "error" ? f.id === id : false));
  return { sent, proxy, until, body, done };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("PreviewProxy", () => {
  it("forwards a request to the worktree's port and streams the answer back", async () => {
    const dev = await devServer();
    const h = harness(dev.port);
    cleanup = () => {
      h.proxy.close();
      dev.wss.close();
      dev.server.close();
    };
    h.proxy.onFrame({
      t: "req",
      id: "r1",
      token: "tok",
      method: "POST",
      path: "/api?x=1",
      headers: { accept: "application/json", host: "evil.example" },
      body: Buffer.from("payload").toString("base64"),
    });
    await h.until(() => h.done("r1"));
    expect(h.sent[0]).toMatchObject({ t: "head", id: "r1", status: 200 });
    expect(JSON.parse(h.body("r1"))).toEqual({
      method: "POST",
      url: "/api?x=1",
      host: `localhost:${String(dev.port)}`,
      accept: "application/json",
      body: "payload",
    });
  });

  it("splits a large answer into chunks under the relay's frame size", async () => {
    const dev = await devServer();
    const h = harness(dev.port);
    cleanup = () => {
      h.proxy.close();
      dev.wss.close();
      dev.server.close();
    };
    h.proxy.onFrame({ t: "req", id: "b", token: "tok", method: "GET", path: "/big", headers: {} });
    await h.until(() => h.done("b"));
    const sizes = h.sent.flatMap((f) => (f.t === "chunk" ? [f.data.length] : []));
    expect(sizes.length).toBeGreaterThan(2);
    for (const n of sizes) expect(n).toBeLessThan(400 * 1024);
    expect(h.body("b")).toHaveLength(BIG);
  });

  it("reaches only an open preview's port, by path (SSRF guard)", () => {
    const h = harness(1);
    h.proxy.onFrame({ t: "req", id: "a", token: "other", method: "GET", path: "/", headers: {} });
    h.proxy.onFrame({
      t: "req",
      id: "b",
      token: "tok",
      method: "GET",
      path: "http://169.254.169.254/",
      headers: {},
    });
    h.proxy.onFrame({ t: "wsOpen", id: "c", token: "other", path: "/", headers: {} });
    expect(h.sent).toEqual([
      { t: "error", id: "a", status: 404, message: "This preview is closed." },
      { t: "error", id: "b", status: 404, message: "This preview is closed." },
      { t: "wsClose", id: "c", code: 1008 },
    ]);
  });

  it("answers 502 when nothing listens on the port", async () => {
    const dev = await devServer();
    const port = dev.port;
    dev.wss.close();
    await new Promise((r) => dev.server.close(r));
    const h = harness(port);
    h.proxy.onFrame({ t: "req", id: "x", token: "tok", method: "GET", path: "/", headers: {} });
    await h.until(() => h.done("x"));
    expect(h.sent[0]).toMatchObject({ t: "error", id: "x", status: 502 });
    expect(await waitForPort(port, 300)).toBe(false);
  });

  it("bridges a WebSocket with its subprotocol, both ways", async () => {
    const dev = await devServer();
    const h = harness(dev.port);
    cleanup = () => {
      h.proxy.close();
      dev.wss.close();
      dev.server.close();
    };
    expect(await waitForPort(dev.port, 1000)).toBe(true);
    h.proxy.onFrame({
      t: "wsOpen",
      id: "w",
      token: "tok",
      path: "/hmr?t=1",
      headers: { "sec-websocket-protocol": "vite-hmr" },
    });
    // Sent before the dev server accepted: held, then delivered.
    h.proxy.onFrame({ t: "wsData", id: "w", data: "early", binary: false });
    await h.until(() => h.sent.some((f) => f.t === "wsData" && f.data === "echo early"));
    expect(h.sent).toContainEqual({ t: "wsData", id: "w", data: "hello /hmr?t=1 vite-hmr", binary: false });
    h.proxy.onFrame({ t: "wsClose", id: "w" });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.sent.filter((f) => f.t === "wsClose")).toEqual([]);
  });
});
