import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import type { TDaemonEvent } from "@agentdeck/protocol";

import type { TScenario } from "../scenario.ts";

export const worktreeLifecycle: TScenario = {
  n: 6,
  title: "Worktree lifecycle",
  summary:
    "Failing setup, port pool, archive keeps work, restore restarts chats, delete cleans up, allow-list",
  covers: [
    "Worktrees: setup scripts, ports, archive / restore / delete; fs.browse limited to the allow-list",
  ],
  async run(h) {
    h.step("A repo whose setup fails for one branch");
    const repoPath = h.makeRepo("api", {
      setup: [
        "node -e \"if (process.env.AGENTDECK_WORKTREE.includes('broken')) { console.error('npm ERR! missing script: bootstrap'); process.exit(3) }\"",
      ],
    });
    const repo = await h.send("repo.add", { path: repoPath });
    const profileId = await h.addProfile("Personal");

    h.step("Create three worktrees");
    let since = h.mark();
    const a = await h.send("worktree.create", { repoId: repo.id, branch: "feature-a", title: "Feature A" });
    const broken = await h.send("worktree.create", {
      repoId: repo.id,
      branch: "broken-setup",
      title: "Broken",
    });
    const b = await h.send("worktree.create", { repoId: repo.id, branch: "feature-b", title: "Feature B" });
    const [wa, wbroken, wb] = [
      await h.waitReady(a.id, since),
      await h.waitReady(broken.id, since),
      await h.waitReady(b.id, since),
    ];
    await h.check("each worktree gets its own port", () => {
      assert.deepEqual([wa.port, wbroken.port, wb.port], [41000, 41001, 41002]);
    });
    await h.check("a failing setup script marks the worktree setup_failed with its output", () => {
      assert.equal(wbroken.status, "setup_failed");
      assert.match(wbroken.setupError ?? "", /missing script: bootstrap/);
    });
    await h.check("no chat can start in a failed worktree", async () => {
      assert.equal(
        await h.sendError("chat.create", { worktreeId: broken.id, agent: "fake", profileId }),
        "BAD_STATE",
      );
    });

    h.step("Work happens in Feature A");
    since = h.mark();
    const chat = await h.send("chat.create", { worktreeId: a.id, agent: "fake", profileId });
    await h.waitStatus(chat.id, "idle", since);
    await h.send("chat.send", {
      chatId: chat.id,
      text: "#script:edit-twice file=wip.txt content=work-in-progress",
    });
    const req = await h.waitFor(
      (e): e is Extract<TDaemonEvent, { type: "permission.requested" }> => e.type === "permission.requested",
      "permission",
      { since },
    );
    {
      await h.send("permission.respond", {
        chatId: chat.id,
        requestId: req.request.requestId,
        decision: "allow_once",
      });
    }
    await h.waitSettled(chat.id);

    h.step("Archive Feature A");
    since = h.mark();
    const archived = await h.send("worktree.archive", { worktreeId: a.id });
    await h.check("archive frees the port and stops the chat", async () => {
      assert.equal(archived.status, "archived");
      assert.equal(archived.port, null);
      await h.waitStatus(chat.id, "stopped", since);
    });
    await h.check("uncommitted work is kept on disk", () => {
      assert.equal(h.readWt(a.id, "wip.txt"), "work-in-progress\n");
    });

    h.step("A new worktree reuses the freed port");
    since = h.mark();
    const c = await h.send("worktree.create", { repoId: repo.id, branch: "feature-c", title: "Feature C" });
    const wc = await h.waitReady(c.id, since);
    await h.check("Feature C gets port 41000", () => {
      assert.equal(wc.port, 41000);
    });

    h.step("Restore Feature A");
    since = h.mark();
    const restored = await h.send("worktree.restore", { worktreeId: a.id });
    await h.waitStatus(chat.id, "idle", since);
    await h.check("restore re-runs setup, assigns a port and restarts the chat", () => {
      assert.equal(restored.status, "ready");
      assert.equal(restored.port, 41003);
    });

    h.step("Delete Feature B");
    since = h.mark();
    await h.send("worktree.delete", { worktreeId: b.id });
    await h.check("the folder and branch are gone", () => {
      assert.equal(existsSync(wb.path), false);
      const branches = execFileSync("git", ["branch", "--list", "feature-b"], { cwd: repoPath }).toString();
      assert.equal(branches.trim(), "");
    });
    await h.check("a worktree.removed event is published", () =>
      h.waitFor((e) => e.type === "worktree.removed" && e.worktreeId === b.id, "removed", { since }),
    );

    h.step("Refs that git could read as options are refused");
    await h.check("a base ref like --upload-pack=… is rejected before git runs", async () => {
      const code = await h.sendError("worktree.create", {
        repoId: repo.id,
        branch: "pwn",
        baseRef: "--upload-pack=touch /tmp/agentdeck-pwned",
        title: "Injection",
      });
      assert.equal(code, "INVALID_ARGS");
      assert.equal(existsSync("/tmp/agentdeck-pwned"), false);
    });

    h.step("Browsing is limited to the allow-list");
    const roots = await h.send("fs.browse", { root: "allowlist" });
    const inside = await h.send("fs.browse", { root: "allowlist", path: h.src });
    await h.check("the browse root lists the allowed folder", () => {
      assert.deepEqual(
        roots.entries.map((e) => e.path),
        [h.src],
      );
    });
    await h.check("repos inside it are flagged as git repos", () => {
      assert.deepEqual(
        inside.entries.map((e) => [e.name, e.isGitRepo]),
        [["api", true]],
      );
    });
    await h.check("folders outside the allow-list are refused", async () => {
      assert.equal(await h.sendError("fs.browse", { root: "allowlist", path: h.home }), "FORBIDDEN_PATH");
      assert.equal(await h.sendError("repo.add", { path: h.home }), "FORBIDDEN_PATH");
    });
  },
};
