import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

export const pathJail: TScenario = {
  n: 3,
  title: "Path jail",
  summary: "Clients and agents stay inside the worktree; .git and secrets stay hidden",
  covers: ["Path jail tests reject ../, symlink escapes and absolute paths"],
  async run(h) {
    h.step("Set up, plus a secret file and an outside file");
    const ids = await h.quickstart();
    const wtPath = h.wtPath(ids.worktreeId);
    writeFileSync(join(h.root, "outside.txt"), "top secret outside the worktree\n");
    writeFileSync(join(wtPath, ".env.local"), "STRIPE_SECRET=sk_live_123\n");
    const canSymlink = process.platform !== "win32";
    if (canSymlink) symlinkSync(join(h.root, "outside.txt"), join(wtPath, "sneaky-link.txt"));

    h.step("Client reads that try to escape");
    const read = (path: string) => h.sendError("fs.read", { worktreeId: ids.worktreeId, path });
    await h.check("../ is rejected", async () => {
      assert.equal(await read("../../outside.txt"), "FORBIDDEN_PATH");
    });
    await h.check("an absolute path is rejected", async () => {
      assert.equal(await read(join(h.root, "outside.txt")), "FORBIDDEN_PATH");
    });
    if (canSymlink) {
      await h.check("a symlink escape is rejected", async () => {
        assert.equal(await read("sneaky-link.txt"), "FORBIDDEN_PATH");
      });
    }
    await h.check(".git internals are hidden", async () => {
      assert.equal(await read(".git/HEAD"), "FORBIDDEN_PATH");
    });
    await h.check("secret globs (.env*) are hidden", async () => {
      assert.equal(await read(".env.local"), "FORBIDDEN_PATH");
    });

    h.step("Listing and search skip hidden files");
    const tree = await h.send("fs.tree", { worktreeId: ids.worktreeId });
    await h.check("the tree shows only safe entries", () => {
      assert.deepEqual(
        tree.entries.map((e) => e.name),
        [".agentdeck", "src", ".gitignore", "README.md"],
      );
    });
    const secret = await h.send("fs.search", { worktreeId: ids.worktreeId, query: "STRIPE_SECRET" });
    const login = await h.send("fs.search", { worktreeId: ids.worktreeId, query: "login" });
    await h.check("ripgrep never returns hidden files", () => {
      assert.deepEqual(secret.matches, []);
    });
    await h.check("ripgrep finds real code", () => {
      assert.deepEqual(login.matches[0], {
        path: "src/app.ts",
        line: 1,
        text: "export function login(user: string) {",
      });
    });
    const ok = await h.send("fs.read", { worktreeId: ids.worktreeId, path: "src/app.ts" });
    await h.check("a normal read works", () => {
      assert.match(ok.text, /export function login/);
    });

    h.step("The agent tries to write outside the worktree");
    let since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "#script:write-outside path=../../escaped.txt" });
    await h.waitStatus(ids.chatId, "idle", since);
    await h.check("fs/write_text_file outside the worktree is refused", () => {
      assert.match(h.agentText(ids.chatId, since), /was refused: FORBIDDEN_PATH/);
      assert.equal(h.readWt(ids.worktreeId, "../../escaped.txt"), null);
    });

    h.step("The agent tries to read the secret file");
    since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "#script:read-file path=.env.local" });
    await h.waitStatus(ids.chatId, "idle", since);
    await h.check("fs/read_text_file of a hidden file is refused", () => {
      assert.match(h.agentText(ids.chatId, since), /Read of \.env\.local was refused: FORBIDDEN_PATH/);
    });
  },
};
