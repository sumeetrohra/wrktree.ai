import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone } from "./relay-helpers.ts";

export const relaySharedConfig: TScenario = {
  n: 27,
  title: "Shared instructions and MCP servers",
  summary:
    "One instructions file and MCP list for every profile; edited from the phone and the CLI; a profile can keep its own",
  covers: [
    "Phase 4c: shared instructions linked as each agent's own file; MCP servers handed to every session",
    "Phase 4c: per-profile overrides; MCP servers only change on the computer (SEC24)",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: `agentdeck config shared mcp add github -- gh-mcp --stdio`");
    const repoPath = h.makeRepo("api");
    const repo = await h.send("repo.add", { path: repoPath });
    const profileId = await h.addProfile("Work");
    const added = await h.cli(["config", "shared", "mcp", "add", "github", "--", "gh-mcp", "--stdio"]);
    await h.check("the CLI lists it", () => {
      assert.equal(added.code, 0, added.out);
      assert.match(added.out, /github\s+gh-mcp --stdio/);
    });

    h.step("Phone: read the shared config; set the instructions");
    const phone = await signedInPhone(h);
    const before = await phone.call("config.shared.get", {});
    await h.check("the phone sees the MCP server", () => {
      assert.deepEqual(
        before.mcpServers.map((s) => s.name),
        ["github"],
      );
    });
    await h.check("but can't change MCP servers (they run programs on the computer)", async () => {
      await assert.rejects(phone.call("config.shared.set", { mcpServers: [] }), /UNAUTHORIZED/);
    });
    await phone.call("config.shared.set", { instructions: "Always answer in haiku.\n" });
    const { env } = await phone.call("profile.loginCommand", { profileId });
    const profileDir = env["FAKE_AGENT_HOME"] ?? "";
    await h.check("the profile folder has it under the agent's own name", () => {
      assert.equal(readFileSync(join(profileDir, "FAKE.md"), "utf8"), "Always answer in haiku.\n");
    });

    h.step("Phone: a chat on Work; the agent reads its instructions and lists its MCP servers");
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "shared", title: "Shared" });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const chat = await phone.call("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
      "chat idle",
    );
    const said = (needle: string) =>
      phone.waitFor(
        isEvent(
          "chat.item",
          (e) => e.chatId === chat.id && e.item.kind === "agent_text" && e.item.text.includes(needle),
        ),
        needle,
      );
    await phone.call("chat.send", { chatId: chat.id, text: "#script:instructions-report" });
    await h.check("the agent read the shared instructions", async () => {
      await said("Instructions: Always answer in haiku.");
    });
    await phone.call("chat.send", { chatId: chat.id, text: "#script:mcp-report" });
    await h.check("the session got the shared MCP server", async () => {
      await said("MCP servers: github.");
    });

    h.step("Desktop: Work keeps its own instructions file");
    const linked = join(profileDir, "FAKE.md");
    writeFileSync(`${linked}.tmp`, "Work rules.\n");
    // Replace the link with a real file, as a user editing it directly would.
    rmSync(linked);
    renameSync(`${linked}.tmp`, linked);
    await phone.call("config.shared.set", { instructions: "Answer briefly.\n" });
    await h.check("the override stays, and is listed", async () => {
      assert.equal(readFileSync(linked, "utf8"), "Work rules.\n");
      assert.deepEqual((await phone.call("profile.overrides", { profileId })).files, ["FAKE.md"]);
    });
    await h.check("only the computer can drop an override", async () => {
      await assert.rejects(
        phone.call("profile.removeOverride", { profileId, name: "FAKE.md" }),
        /UNAUTHORIZED/,
      );
      const removed = await h.cli(["config", "overrides", profileId, "remove", "FAKE.md"]);
      assert.equal(removed.code, 0, removed.out);
      assert.equal(readFileSync(linked, "utf8"), "Answer briefly.\n");
      assert.ok(existsSync(linked));
    });
  },
};
