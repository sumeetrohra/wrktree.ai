import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

export const chatLifecycle: TScenario = {
  n: 4,
  title: "Chat lifecycle",
  summary: "Queue while running, cancel, crash with auto-restart, give up after 3, retry, usage limits",
  covers: [
    "Chat lifecycle state machine: queued sends, cancel, crashed → auto-restart (max 3), limited → idle",
    "Phase 4a: sends queue while a profile is limited and go out at the reset; usage per profile",
  ],
  async run(h) {
    h.step("Set up a chat");
    const ids = await h.quickstart();
    const chat = ids.chatId;

    h.step("A message sent while running is queued");
    let since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "Do the slow thing #script:slow ms=1500" });
    await h.waitStatus(chat, "running", since);
    const second = await h.send("chat.send", { chatId: chat, text: "Then this" });
    await h.check("the second send reports queued", () => {
      assert.equal(second.queued, true);
    });
    await h.waitText(chat, "You said: Then this", since);
    await h.check("it is delivered once the first turn ends", () => {
      assert.ok(
        h.agentText(chat, since).indexOf("Finished the slow task") <
          h.agentText(chat, since).indexOf("You said: Then this"),
      );
    });
    await h.waitSettled(chat);

    h.step("Cancel a running turn");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:slow ms=60000" });
    await h.waitText(chat, "Working on it", since);
    await h.send("chat.cancel", { chatId: chat });
    await h.waitStatus(chat, "idle", since);
    await h.check("cancel returns the chat to idle", () => {
      assert.ok(h.systemText(chat, since).includes("Turn cancelled."));
    });

    h.step("The adapter crashes mid-turn");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:crash" });
    await h.waitStatus(chat, "crashed", since);
    await h.waitStatus(chat, "idle", since);
    await h.check("it is restarted automatically and comes back idle", () => {
      assert.ok(h.systemText(chat, since).some((t) => t.startsWith("Restarting the agent (attempt 1 of 3)")));
    });
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "Still alive?" });
    await h.waitText(chat, "You said: Still alive?", since);
    await h.waitSettled(chat);

    h.step("An adapter that keeps crashing");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:crash-forever" });
    await h.waitFor(
      (e) =>
        e.type === "chat.item" &&
        e.chatId === chat &&
        e.item.kind === "system" &&
        e.item.text.startsWith("Gave up"),
      "give up",
      { since, timeoutMs: 30_000 },
    );
    await h.check("after 3 failed restarts the chat stays crashed", () => {
      const restarts = h.systemText(chat, since).filter((t) => t.startsWith("Restarting the agent"));
      assert.equal(restarts.length, 3);
    });
    await h.check("sending to a crashed chat is refused", async () => {
      assert.equal(await h.sendError("chat.send", { chatId: chat, text: "hello?" }), "BAD_STATE");
    });

    h.step("Fix the agent and retry");
    rmSync(join(h.home, "profiles", ids.profileId, "fake-crash-on-start"));
    since = h.mark();
    await h.send("chat.retry", { chatId: chat });
    await h.waitStatus(chat, "idle", since);
    await h.check("retry brings the chat back", async () => {
      const [c] = await h.client.call("chat.list", { worktreeId: ids.worktreeId });
      assert.equal(c!.status, "idle");
    });

    h.step("The profile hits its usage limit");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:limit resetInMs=2500" });
    const limited = await h.waitStatus(chat, "limited", since);
    await h.check("the chat is limited with a reset time", () => {
      assert.ok(limited.type === "chat.status" && typeof limited.resetAt === "number");
    });
    await h.check("a usage.updated event reports the limit", async () => {
      const e = await h.waitFor((e) => e.type === "usage.updated" && e.usage.limitHit, "usage event", {
        since,
      });
      assert.ok(e.type === "usage.updated" && e.profileId === ids.profileId);
    });
    await h.check("a send while limited is queued, not refused", async () => {
      const r = await h.send("chat.send", { chatId: chat, text: "after the reset" });
      assert.equal(r.queued, true);
    });
    await h.check("after the reset time the queued message goes out", async () => {
      await h.waitText(chat, "after the reset", since, 15_000);
      await h.waitSettled(chat);
    });
    await h.check("the profile's usage shows the limit lifted and today's tokens", async () => {
      const usage = await h.send("profile.usage", { profileId: ids.profileId });
      assert.equal(usage.limitHit, false);
      assert.ok((usage.inputTokens ?? 0) > 0 && (usage.outputTokens ?? 0) > 0);
    });
  },
};
