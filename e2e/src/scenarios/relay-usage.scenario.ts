import assert from "node:assert/strict";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone } from "./relay-helpers.ts";

export const relayUsage: TScenario = {
  n: 23,
  title: "Usage limits from the phone",
  summary:
    "Tokens per profile; a limit the agent states in its reply; messages queue and go out at the reset",
  covers: [
    "Phase 4a: per-profile usage (today's tokens, limit state, reset time) on the phone",
    "Phase 4a: limits read from what the agent says, with their reset time",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo and a profile; Phone: a chat");
    const repoPath = h.makeRepo("api");
    const repo = await h.send("repo.add", { path: repoPath });
    const profileId = await h.addProfile("Work");
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "usage", title: "Usage" });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const chat = await phone.call("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
      "chat idle",
    );

    h.step("Phone: a turn; the profile's tokens count it");
    await phone.call("chat.send", { chatId: chat.id, text: "hello" });
    await phone.waitFor(
      isEvent("usage.updated", (e) => e.profileId === profileId && (e.usage.inputTokens ?? 0) > 0),
      "usage update",
    );
    const fresh = await phone.call("profile.usage", { profileId });
    await h.check("today's tokens, not limited", () => {
      assert.equal(fresh.limitHit, false);
      assert.equal(fresh.inputTokens, "hello".length);
      assert.ok((fresh.outputTokens ?? 0) > 0);
    });

    h.step("Phone: the agent answers that it hit its limit (resets in 3s)");
    const before = Date.now();
    await phone.call("chat.send", { chatId: chat.id, text: "#script:limit-reply resetIn=3s" });
    const limited = await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "limited"),
      "limited",
    );
    await h.check("the chat is limited, with the reset time read from the reply", () => {
      assert.ok(limited.event.type === "chat.status");
      const resetAt = limited.event.resetAt ?? 0;
      assert.ok(resetAt >= before + 2500 && resetAt <= Date.now() + 3500, String(resetAt));
    });
    await h.check("the profile reads as limited, with its reset time", async () => {
      const u = await phone.call("profile.usage", { profileId });
      assert.equal(u.limitHit, true);
      assert.equal(u.resetAt, limited.event.type === "chat.status" ? limited.event.resetAt : -1);
    });

    h.step("Phone: a message while limited is queued; it goes out at the reset");
    const sent = await phone.call("chat.send", { chatId: chat.id, text: "carry on" });
    await h.check("queued", () => {
      assert.equal(sent.queued, true);
    });
    const mark = phone.events.length;
    const after = (pred: ReturnType<typeof isEvent>) => (f: Parameters<typeof pred>[0] & object) =>
      phone.events.indexOf(f as (typeof phone.events)[number]) >= mark && pred(f);
    await phone.waitFor(
      after(isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "running")),
      "the queued message goes out at the reset",
      15_000,
    );
    await phone.waitFor(
      after(isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle")),
      "the turn ends",
    );
    await phone.waitFor(
      isEvent("usage.updated", (e) => e.profileId === profileId && !e.usage.limitHit),
      "limit lifted",
    );
    await h.check("the profile is available again", async () => {
      assert.equal((await phone.call("profile.usage", { profileId })).limitHit, false);
    });
  },
};
