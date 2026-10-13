import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone } from "./relay-helpers.ts";
import { PREVIEW_DEV_SERVER } from "./relay-preview.scenario.ts";

const CANARY = "sealed-page-canary-4XQ";

export const relaySealedPreview: TScenario = {
  n: 36,
  title: "Preview, sealed end to end",
  summary:
    "The phone fetches the dev server's page and hot-reload socket through sealed commands: the relay sees none of it",
  covers: [
    "Phase 5e: `preview.start` with `mode: sealed`, `preview.fetch`, `preview.ws*` and live `preview.ws` events",
    "SEC26: a sealed preview token works for the device that started it only, and dies with the preview",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo with a dev server that hot-reloads");
    const repoPath = h.makeRepo(
      "web",
      { scripts: { dev: "node serve.cjs" }, preview: { script: "dev" } },
      { files: { "serve.cjs": PREVIEW_DEV_SERVER, "index.html": `<h1>${CANARY} one</h1>` } },
    );
    const repo = await h.send("repo.add", { path: repoPath });
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "sealed", title: "Sealed" });
    const ready = await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    assert.ok(ready.event.type === "worktree.updated");
    const wtPath = ready.event.worktree.path;

    h.step("Phone: start a sealed preview");
    const opened = await phone.call("preview.start", { worktreeId: wt.id, mode: "sealed" });
    const token = opened.token ?? "";
    await h.check("a token for this device, and no relay URL or key", () => {
      assert.match(token, /^[0-9a-f]{32}$/);
      assert.equal(opened.key, null);
      assert.ok(!opened.url.includes(".preview."));
    });

    h.step("Phone: fetch the page through sealed commands");
    const page = await phone.call("preview.fetch", {
      token,
      method: "GET",
      path: "/",
      headers: { accept: "text/html" },
    });
    await h.check("the dev server's page", () => {
      assert.equal(page.status, 200);
      assert.match(page.headers["content-type"] ?? "", /text\/html/);
      assert.ok(Buffer.from(page.body, "base64").toString().includes(`${CANARY} one`));
    });

    h.step("Phone: open the hot-reload socket; the page changes on the computer");
    // The phone picks the socket's id and subscribes first: its events are live only.
    const wsId = `pws_${randomBytes(12).toString("hex")}`;
    await phone.follow(`preview:${wsId}`);
    await phone.call("preview.wsOpen", {
      wsId,
      token,
      path: "/hmr",
      headers: { "sec-websocket-protocol": "vite-hmr" },
    });
    await phone.waitFor(
      isEvent("preview.ws", (e) => e.wsId === wsId && e.data === "connected /hmr"),
      "the socket connected",
    );
    writeFileSync(join(wtPath, "index.html"), `<h1>${CANARY} two</h1>`);
    await h.check("the reload message arrives as a sealed event", async () => {
      await phone.waitFor(
        isEvent("preview.ws", (e) => e.wsId === wsId && e.data === "reload"),
        "reload",
      );
      const again = await phone.call("preview.fetch", { token, method: "GET", path: "/", headers: {} });
      assert.ok(Buffer.from(again.body, "base64").toString().includes(`${CANARY} two`));
    });
    await h.check("the page never crossed the relay in the clear", () => {
      const wire = phone.wire.join("\n");
      assert.ok(wire.length > 0);
      assert.ok(!wire.includes(CANARY));
      assert.ok(!h.relayLog.join("\n").includes(CANARY));
    });

    h.step("Another client, and after the preview stops");
    await h.check("the token is useless to any other client (here the desktop's own)", async () => {
      await assert.rejects(
        h.send("preview.fetch", { token, method: "GET", path: "/", headers: {} }),
        /NOT_FOUND/,
      );
      await assert.rejects(h.send("preview.wsSend", { wsId, data: "x", binary: false }), /NOT_FOUND/);
    });
    await phone.call("preview.stop", { worktreeId: wt.id });
    await h.check("and dead once the preview stops", async () => {
      await assert.rejects(
        phone.call("preview.fetch", { token, method: "GET", path: "/", headers: {} }),
        /NOT_FOUND/,
      );
    });
  },
};
