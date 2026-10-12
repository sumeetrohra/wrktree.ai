import assert from "node:assert/strict";

import { Harness } from "../harness.ts";
import type { TScenario } from "../scenario.ts";

import { isEvent, linkHost, signedInPhone } from "./relay-helpers.ts";

export const relayMultiHost: TScenario = {
  n: 13,
  title: "Two computers, one phone",
  summary: "Both computers link to one account; the phone sees all their work and runs a task on either",
  covers: [
    "Phase 2c: many hosts and many consumers on one account",
    "Phase 2c: workspace.overview shows branches, chats, agents, profiles and models per host",
  ],
  relay: true,
  async run(h) {
    const a = await h.quickstart("shop");
    const phone = await signedInPhone(h);
    const hostA = phone.daemonId;

    h.step("A second computer, `desktop`, on the same relay");
    const b = await Harness.start(h.sink, { relayUrl: h.relayUrl, hostName: "desktop", watch: false });
    try {
      const hostB = await linkHost(b, phone);
      const hosts = await phone.hosts();
      await h.check("the phone sees both computers", () => {
        assert.deepEqual(hosts.map((d) => d.name).sort(), ["desktop", "laptop"]);
      });

      h.step("Phone: a task on `desktop`, picking the host, repo, profile and model");
      const repoPath = b.makeRepo("api");
      const repo = await b.send("repo.add", { path: repoPath });
      const profileId = await b.addProfile("Work");
      await phone.use(hostB).connect();
      const wt = await phone.call("worktree.create", {
        repoId: repo.id,
        branch: "fix-login",
        title: "Fix login",
      });
      await phone.waitFor(
        isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
        "worktree ready",
      );
      const chat = await phone.call("chat.create", {
        worktreeId: wt.id,
        agent: "fake",
        profileId,
        model: "fake-large",
      });
      await phone.waitFor(
        isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
        "chat idle",
      );
      await phone.call("chat.send", { chatId: chat.id, text: "hello from the phone" });
      await phone.waitFor(
        isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "running"),
        "turn starts",
      );
      await phone.waitFor(
        isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
        "turn ends",
      );

      h.step("Phone: the overview of every computer");
      const overB = await phone.call("workspace.overview", {});
      phone.use(hostA);
      const overA = await phone.call("workspace.overview", {});
      await h.check("each host reports its own branches and chats", () => {
        assert.equal(overA.host.name, "laptop");
        assert.equal(overB.host.name, "desktop");
        assert.deepEqual(
          overA.worktrees.map((w) => w.branch),
          ["agent-task"],
        );
        assert.deepEqual(
          overB.worktrees.map((w) => w.branch),
          ["fix-login"],
        );
        assert.equal(overA.chats[0]?.id, a.chatId);
      });
      await h.check("with the agent, profile and model of each chat", () => {
        const c = overB.chats.find((x) => x.id === chat.id);
        assert.ok(c);
        assert.equal(c.agent, "fake");
        assert.equal(overB.profiles.find((p) => p.id === c.profileId)?.name, "Work");
        assert.equal(c.model, "fake-large");
      });

      h.step("`agentdeck hosts` on either computer lists both");
      const { stdout } = await b.cli(["hosts"]);
      await h.check("both names, this computer marked", () => {
        assert.ok(stdout.includes("laptop") && stdout.includes("desktop"), stdout);
        assert.ok(/desktop.*\(this computer\)/.test(stdout), stdout);
      });

      h.step("Remove `desktop` from the phone");
      await phone.remove(hostB);
      await h.check("it drops off the account and unlinks itself", async () => {
        assert.deepEqual(
          (await phone.hosts()).map((d) => d.name),
          ["laptop"],
        );
        const end = Date.now() + 10_000;
        while ((await b.client.call("account.status", {})).state !== "unlinked") {
          if (Date.now() > end) throw new Error("desktop is still linked");
          await new Promise((r) => setTimeout(r, 100));
        }
      });
    } finally {
      await b.stop();
    }
  },
};
