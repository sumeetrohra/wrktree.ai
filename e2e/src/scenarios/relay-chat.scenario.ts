import assert from "node:assert/strict";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone, type TRequested } from "./relay-helpers.ts";

export const relayChat: TScenario = {
  n: 9,
  title: "A whole task from the phone",
  summary: "New worktree, chat, prompt, permission, approval, diff: every frame sealed end to end",
  covers: ["Phase 2: start a task from the phone, approve a permission, see the turn finish"],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo and a logged-in profile");
    const repo = await h.send("repo.add", { path: h.makeRepo("shop") });
    const profileId = await h.addProfile("Personal");
    const phone = await signedInPhone(h);

    h.step("Phone: new task (worktree + chat)");
    const wt = await phone.call("worktree.create", {
      repoId: repo.id,
      branch: "from-phone",
      title: "From the phone",
    });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const chat = await phone.call("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
      "chat idle",
    );

    h.step("Phone: send a prompt; the agent asks for permission");
    await phone.call("chat.send", { chatId: chat.id, text: "#script:golden file=NOTES.md" });
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === chat.id),
        "permission",
      )
    ).event as TRequested;

    h.step("Phone: approve; the turn finishes");
    const before = phone.events.length;
    await phone.call("permission.respond", {
      chatId: chat.id,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await phone.waitFor(
      (f) =>
        phone.events.indexOf(f) >= before &&
        isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle")(f),
      "turn finished",
    );
    const diff = await phone.call("diff.summary", { worktreeId: wt.id });
    await h.check("the phone sees the agent's change in the diff", () => {
      assert.ok(
        diff.files.some((f) => f.path === "NOTES.md"),
        JSON.stringify(diff),
      );
    });
    await h.check("the phone saw every event in order, with no gaps", () => {
      assert.deepEqual(phone.gaps, []);
    });
    await h.check("the desktop saw the same chat, live", () => {
      assert.ok(h.events.some((f) => f.event.type === "permission.resolved" && f.event.chatId === chat.id));
    });
  },
};
