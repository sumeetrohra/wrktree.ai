import assert from "node:assert/strict";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone } from "./relay-helpers.ts";

/** A tiny dev server: prints, then serves on $PORT (the worktree's preview port). */
const SERVER = `const http = require("node:http");
const port = Number(process.env.PORT);
console.log("starting the dev server");
http
  .createServer((req, res) => res.end("hello from the dev server"))
  .listen(port, "127.0.0.1", () => console.log("listening on " + port));
`;

export const relayProcs: TScenario = {
  n: 19,
  title: "Scripts and logs from the phone",
  summary: "Start the repo's dev script, watch its output live, reach it on its port, stop it",
  covers: [
    "Phase 3b: run the repo's scripts (by name only) and follow their logs from the phone",
    "Phase 3b: opening an editor is local-only",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo whose config names two scripts");
    const repoPath = h.makeRepo(
      "site",
      { scripts: { dev: "node serve.cjs", fail: `node -e "console.error('boom'); process.exit(2)"` } },
      { files: { "serve.cjs": SERVER } },
    );
    const repo = await h.send("repo.add", { path: repoPath });
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "logs", title: "Logs" });
    const ready = await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const port = ready.event.type === "worktree.updated" ? ready.event.worktree.port : null;
    assert.ok(port !== null);

    h.step("Phone: the Logs tab lists the scripts; start `dev`");
    const list = await phone.call("proc.list", { worktreeId: wt.id });
    await h.check("only the scripts the repo names", () => {
      assert.deepEqual(list.scripts, ["dev", "fail"]);
      assert.deepEqual(list.procs, []);
    });
    const proc = await phone.call("proc.start", { worktreeId: wt.id, script: "dev" });
    await phone.follow(`proc:${proc.id}`);
    await phone.waitFor(
      isEvent("proc.output", (e) => e.procId === proc.id && e.chunk.includes(`listening on ${String(port)}`)),
      "the server's output",
    );
    await h.check("the server answers on the worktree's port", async () => {
      const res = await fetch(`http://127.0.0.1:${String(port)}/`);
      assert.equal(await res.text(), "hello from the dev server");
    });
    await h.check("the log so far is readable as one blob", async () => {
      const { blob, cursor } = await phone.call("proc.output", { procId: proc.id });
      const { base64 } = await phone.call("blob.get", { blobId: blob.blobId });
      assert.match(Buffer.from(base64, "base64").toString(), /starting the dev server\n.*listening on/s);
      assert.ok(cursor >= 1);
    });

    h.step("Phone: stop it");
    const stopped = await phone.call("proc.stop", { procId: proc.id });
    await h.check("stopped, and the port is closed", async () => {
      assert.equal(stopped.status, "stopped");
      await assert.rejects(fetch(`http://127.0.0.1:${String(port)}/`));
    });

    h.step("Phone: a script that fails");
    const failing = await phone.call("proc.start", { worktreeId: wt.id, script: "fail" });
    const ended = await phone.waitFor(
      isEvent("proc.status", (e) => e.proc.id === failing.id && e.proc.status !== "running"),
      "the failing script to end",
    );
    await h.check("reported as crashed with its exit code", () => {
      assert.ok(ended.event.type === "proc.status");
      assert.equal(ended.event.proc.status, "crashed");
      assert.equal(ended.event.proc.exitCode, 2);
    });

    h.step("Phone: what it can't do");
    await h.check("a command that isn't a named script is refused", async () => {
      await assert.rejects(
        phone.call("proc.start", { worktreeId: wt.id, script: "rm -rf ." }),
        /INVALID_ARGS/,
      );
    });
    await h.check("opening an editor on the computer is refused remotely", async () => {
      await assert.rejects(
        phone.call("editor.open", { worktreeId: wt.id, editor: "vscode" }),
        /UNAUTHORIZED/,
      );
    });
  },
};
