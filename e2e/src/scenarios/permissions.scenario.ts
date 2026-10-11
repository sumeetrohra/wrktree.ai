import assert from "node:assert/strict";

import type { TDaemonEvent } from "@agentdeck/protocol";

import type { TScenario } from "../scenario.ts";

type TRequested = Extract<TDaemonEvent, { type: "permission.requested" }>;

export const permissions: TScenario = {
  n: 5,
  title: "Permissions",
  summary: "Allow always remembers, deny + message steers the agent, a pending request survives a disconnect",
  covers: ["Permission broker: allow once / always / deny + message; requests never time out"],
  async run(h) {
    h.step("Set up a chat");
    const ids = await h.quickstart();
    const chat = ids.chatId;
    const requested = (since: number) =>
      h.waitFor(
        (e): e is TRequested => e.type === "permission.requested" && e.chatId === chat,
        "permission request",
        { since },
      );

    h.step("Allow always");
    let since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:edit-twice file=app.txt content=first" });
    let req = await requested(since);
    await h.send("permission.respond", {
      chatId: chat,
      requestId: req.request.requestId,
      decision: "allow_always",
    });
    await h.waitStatus(chat, "idle", since);
    await h.check("the first edit lands", () => {
      assert.equal(h.readWt(ids.worktreeId, "app.txt"), "first\n");
    });

    h.step("The same edit again is approved by the saved rule");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:edit-twice file=app.txt content=second" });
    await h.waitStatus(chat, "idle", since);
    await h.check("answered automatically, never awaiting permission", () => {
      const statuses = h.events
        .slice(since)
        .flatMap((f) => (f.event.type === "chat.status" ? [f.event.status] : []));
      assert.ok(!statuses.includes("awaiting_permission"));
      assert.ok(h.events.slice(since).some((f) => f.event.type === "permission.resolved" && f.event.auto));
      assert.equal(h.readWt(ids.worktreeId, "app.txt"), "second\n");
    });

    h.step("Deny with a message");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:edit-twice file=config.txt" });
    req = await requested(since);
    await h.send("permission.respond", {
      chatId: chat,
      requestId: req.request.requestId,
      decision: "deny",
      message: "Put it in docs/ instead",
    });
    await h.waitText(chat, "You said: Put it in docs/ instead", since);
    await h.waitSettled(chat);
    await h.check("the edit was not made", () => {
      assert.equal(h.readWt(ids.worktreeId, "config.txt"), null);
    });
    await h.check("the agent heard the denial, then the message", () => {
      const text = h.agentText(chat, since);
      assert.ok(text.indexOf("Permission denied") < text.indexOf("Put it in docs/ instead"));
    });

    h.step("A pending request survives a client disconnect");
    since = h.mark();
    await h.send("chat.send", { chatId: chat, text: "#script:edit-twice file=late.txt" });
    req = await requested(since);
    await h.stopWatcher();
    h.client.close();
    await h.pause(2000);
    await h.connect();
    await h.startWatcher([
      `chat:${chat}`,
      "--from",
      String(h.events.filter((e) => e.topic === `chat:${chat}`).at(-1)!.cursor - 2),
    ]);
    await h.check("after reconnecting the request is still pending", async () => {
      const [c] = await h.send("chat.list", { worktreeId: ids.worktreeId });
      assert.equal(c!.status, "awaiting_permission");
    });
    await h.send("permission.respond", {
      chatId: chat,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await h.waitStatus(chat, "idle", since);
    await h.check("approving it later finishes the turn", () => {
      assert.equal(h.readWt(ids.worktreeId, "late.txt"), "first\n");
    });
  },
};
