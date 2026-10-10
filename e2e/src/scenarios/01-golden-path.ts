import assert from "node:assert/strict";
import { join } from "node:path";
import type { Scenario } from "../scenario.ts";
import { FIXTURES } from "../harness.ts";

export const goldenPath: Scenario = {
  n: 1,
  title: "Golden path",
  summary: "Repo → two profiles → worktree → one chat per profile → image prompt → approve → diff",
  covers: [
    "From the CLI: add a repo, create two profiles, create a worktree, start one chat per profile, send a prompt with an image, approve a permission, read the diff",
  ],
  async run(h) {
    h.step("Add a repository");
    const repoPath = h.makeRepo("shop", {
      setup: ["node -e \"require('fs').writeFileSync('.setup-ran', process.env.AGENTDECK_PORT)\""],
    });
    const repo = await h.send("repo.add", { path: repoPath });
    await h.check("repo added with its default branch", () => assert.equal(repo.defaultBase, "main"));

    h.step("Create two profiles and log each in");
    const personal = await h.addProfile("Personal");
    const work = await h.addProfile("Work");
    const status = await h.send("profile.loginStatus", { profileId: work });
    await h.check("both profiles exist with isolated config folders", async () => {
      const list = await h.client.call("profile.list", { agent: "fake" });
      assert.deepEqual(
        list.map((p) => p.name),
        ["Personal", "Work"],
      );
    });
    await h.check("Work profile reports logged in", () => assert.equal(status.loggedIn, true));

    h.step("Create a worktree; its setup script runs");
    let since = h.mark();
    const created = await h.send("worktree.create", {
      repoId: repo.id,
      branch: "add-notes",
      title: "Add release notes",
    });
    const wt = await h.waitReady(created.id, since);
    await h.check("worktree goes creating → setting_up → ready", () => assert.equal(wt.status, "ready"));
    await h.check("a preview port was assigned and passed to setup", () => {
      assert.equal(wt.port, 41000);
      assert.equal(h.readWt(wt.id, ".setup-ran"), "41000");
    });

    h.step("Start one chat per profile");
    since = h.mark();
    const chatA = await h.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId: personal });
    const chatB = await h.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId: work });
    await h.waitStatus(chatA.id, "idle", since);
    await h.waitStatus(chatB.id, "idle", since);
    await h.check("both chats reach idle", async () => {
      const chats = await h.client.call("chat.list", { worktreeId: wt.id });
      assert.deepEqual(
        chats.map((c) => c.status),
        ["idle", "idle"],
      );
    });

    h.step("Attach a screenshot and send a prompt");
    const { stdout } = await h.cli(["dev", "blob", join(FIXTURES, "screenshot.png")], {
      show: "agentdeck dev blob e2e/fixtures/screenshot.png",
    });
    const image = JSON.parse(stdout) as { blobId: string; mime: string; size: number };
    since = h.mark();
    await h.send("chat.send", {
      chatId: chatA.id,
      text: "Write release notes into NOTES.md #script:golden file=NOTES.md",
      attachments: [image],
    });
    const req = await h.waitFor(
      (e) => e.type === "permission.requested" && e.chatId === chatA.id,
      "a permission request",
      { since },
    );
    await h.waitStatus(chatA.id, "awaiting_permission", since);
    await h.check("the agent received the image", () =>
      assert.match(h.agentText(chatA.id, since), /Received 1 image\(s\): image\/png \(\d+ bytes\)/),
    );
    await h.check("the edit waits for permission", () => {
      assert.equal(req.type === "permission.requested" && req.request.locations[0], "NOTES.md");
      assert.equal(h.readWt(wt.id, "NOTES.md"), null);
    });

    h.step("Approve the edit");
    const requestId = req.type === "permission.requested" ? req.request.requestId : "";
    await h.send("permission.respond", { chatId: chatA.id, requestId, decision: "allow_once" });
    await h.waitStatus(chatA.id, "idle", since);
    await h.check("the agent wrote NOTES.md after approval", () =>
      assert.match(h.readWt(wt.id, "NOTES.md") ?? "", /Written by the fake agent/),
    );

    h.step("Second chat runs on the Work profile");
    since = h.mark();
    await h.send("chat.send", { chatId: chatB.id, text: "Hello from the work account" });
    await h.waitText(chatB.id, "You said: Hello from the work account", since);
    await h.check("the Work chat answers independently", () =>
      assert.match(h.agentText(chatB.id, since), /work account/),
    );

    h.step("Review the diff");
    const summary = await h.send("diff.summary", { worktreeId: wt.id });
    await h.check("diff summary lists NOTES.md with +4 lines", () =>
      assert.deepEqual(summary.files, [{ path: "NOTES.md", added: 4, removed: 0, status: "untracked" }]),
    );
    const diff = await h.send("diff.file", { worktreeId: wt.id, path: "NOTES.md" });
    const body = await h.client.call("blob.get", { blobId: diff.blob.blobId });
    await h.check("file diff is a unified diff of the new file", () => {
      const text = Buffer.from(body.base64, "base64").toString();
      assert.match(text, /^\+Written by the fake agent\.$/m);
      assert.equal(diff.blob.mime, "text/x-diff");
    });
  },
};
