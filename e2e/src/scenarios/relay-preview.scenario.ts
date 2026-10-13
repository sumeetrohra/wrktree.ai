import assert from "node:assert/strict";

import { PreviewBrowser } from "../preview-browser.ts";
import type { TScenario } from "../scenario.ts";

import { eventually, isEvent, signedInPhone, type TRequested } from "./relay-helpers.ts";

/**
 * A dev server with hot reload, no dependencies: serves index.html on $PORT and pushes "reload" on
 * a hand-rolled WebSocket whenever index.html changes.
 */
export const PREVIEW_DEV_SERVER = String.raw`const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const port = Number(process.env.PORT);
const sockets = new Set();
const frame = (text) => {
  const b = Buffer.from(text);
  return Buffer.concat([Buffer.from([0x81, b.length]), b]);
};
fs.watch(__dirname, (_event, file) => {
  if (file && file !== "index.html") return;
  for (const s of sockets) s.write(frame("reload"));
});
http
  .createServer((req, res) => {
    if (req.url === "/env") {
      res.end(JSON.stringify({ preview: process.env.AGENTDECK_PREVIEW, hmr: process.env.HMR_CLIENT_PORT }));
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  })
  .on("upgrade", (req, socket) => {
    const accept = crypto
      .createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    const proto = (req.headers["sec-websocket-protocol"] || "").split(",")[0].trim();
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " + accept + "\r\n" +
        (proto ? "Sec-WebSocket-Protocol: " + proto + "\r\n" : "") + "\r\n",
    );
    sockets.add(socket);
    socket.write(frame("connected " + req.url));
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  })
  .listen(port, "127.0.0.1", () => console.log("dev server on " + port));
`;

/** A page that reloads itself when its dev server says so, like Vite's client. */
export const PREVIEW_PAGE = `<h1>version one</h1>
<script>
  const hmr = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/hmr", ["vite-hmr"]);
  hmr.onmessage = (e) => { if (e.data === "reload") location.reload(); };
</script>
`;

export const relayPreview: TScenario = {
  n: 21,
  title: "Preview the app from the phone",
  summary: "The worktree's dev server opens on the phone through the relay, and hot-reloads",
  covers: [
    "Phase 3c: preview a worktree's dev server through a relay tunnel, with no ports exposed",
    "Phase 3c: a one-time key becomes a cookie; a forwarded link opens nothing",
    "Phase 3c: WebSockets (hot reload) cross the tunnel",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo whose config names a preview script");
    const repoPath = h.makeRepo(
      "web",
      {
        scripts: { dev: "node serve.cjs" },
        preview: { script: "dev", env: { HMR_CLIENT_PORT: "443" } },
      },
      { files: { "serve.cjs": PREVIEW_DEV_SERVER, "index.html": PREVIEW_PAGE } },
    );
    const repo = await h.send("repo.add", { path: repoPath });
    const profileId = await h.addProfile("Personal");
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "preview", title: "Preview" });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );

    h.step("Phone: Preview → start");
    const opened = await phone.call("preview.start", { worktreeId: wt.id });
    await h.check("a relay URL on a preview host, with a one-time key", () => {
      assert.match(new URL(opened.url).hostname, /^[0-9a-z]{58}\.preview\.localhost$/);
      assert.ok(opened.key !== null && opened.key.length > 20);
      assert.ok(opened.expiresAt !== null && opened.expiresAt > Date.now());
    });
    await phone.waitFor(
      isEvent("preview.status", (e) => e.worktreeId === wt.id && e.status === "ready"),
      "preview ready",
    );
    const key = opened.key ?? "";

    h.step("A forwarded link, without the key's cookie, opens nothing");
    const forwarded = new PreviewBrowser(h.relayUrl, opened.url);
    await h.check("403 without the cookie", async () => {
      assert.equal((await forwarded.get("/")).status, 403);
    });

    h.step("Phone: the page loads with the key, once");
    const tab = new PreviewBrowser(h.relayUrl, opened.url);
    const page = await tab.open(key);
    await h.check("the dev server's page, through the tunnel", () => {
      assert.equal(page.status, 200);
      assert.match(page.body, /version one/);
      assert.ok(tab.cookie?.startsWith("agentdeck_preview="));
    });
    await h.check("the key is used up", async () => {
      assert.equal((await forwarded.open(key)).status, 403);
    });
    await h.check("the preview script got the repo's env hints", async () => {
      assert.deepEqual(JSON.parse((await tab.get("/env")).body), { preview: "1", hmr: "443" });
    });

    h.step("Phone: the page's hot-reload socket connects");
    const hmr = await tab.socket("/hmr?token=abc", ["vite-hmr"]);
    await h.check("the dev server greets it through the tunnel", () =>
      eventually(
        "the greeting",
        () => Promise.resolve(hmr.received),
        (r) => r.includes("connected /hmr?token=abc"),
      ),
    );

    h.step("Phone: ask the agent to change the page (approved)");
    const chat = await phone.call("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
      "chat idle",
    );
    await phone.call("chat.send", {
      chatId: chat.id,
      text: "#script:edit-twice file=index.html content=<h1>version-two</h1>",
    });
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === chat.id),
        "permission",
      )
    ).event as TRequested;
    await phone.call("permission.respond", {
      chatId: chat.id,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await h.check("the page's socket hears reload", () =>
      eventually(
        "reload",
        () => Promise.resolve(hmr.received),
        (r) => r.includes("reload"),
      ),
    );
    await h.check("and reloads the new version", async () => {
      assert.match((await tab.get("/")).body, /version-two/);
    });
    hmr.close();

    h.step("Desktop: the same preview on this computer is plain localhost");
    const local = await h.send("preview.start", { worktreeId: wt.id });
    await h.check("localhost, no key", async () => {
      assert.equal(local.key, null);
      assert.match(local.url, /^http:\/\/localhost:\d+\/$/);
      assert.match(await (await fetch(local.url.replace("localhost", "127.0.0.1"))).text(), /version-two/);
    });

    h.step("Phone: stop the preview");
    await phone.call("preview.stop", { worktreeId: wt.id });
    await h.check("the link opens nothing, and the dev server is stopped", async () => {
      assert.equal((await tab.get("/")).status, 403);
      await assert.rejects(fetch(local.url.replace("localhost", "127.0.0.1")));
    });
  },
};
