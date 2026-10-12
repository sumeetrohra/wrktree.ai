import assert from "node:assert/strict";

import { PUSH_MESSAGE } from "@agentdeck/relay";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone, type TRequested } from "./relay-helpers.ts";

export const relayOffline: TScenario = {
  n: 10,
  title: "Phone offline while the agent works",
  summary: "A content-free push wakes the phone; reconnecting replays every event in order, nothing twice",
  covers: [
    "Phase 2: permission push with the app closed",
    "Phase 2: offline phone reconnects with every event in order and no gaps",
  ],
  relay: true,
  async run(h) {
    const ids = await h.quickstart();
    const phone = await signedInPhone(h);
    await phone.registerPush("ExponentPushToken[e2e-phone]");

    h.step("The phone goes offline (airplane mode)");
    phone.disconnect();
    await h.pause(300);

    h.step("Desktop: the agent works and asks for permission");
    const since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "#script:golden file=OFFLINE.md" });
    await h.waitFor((e) => e.type === "permission.requested" && e.chatId === ids.chatId, "permission", {
      since,
    });
    await h.pause(500);

    const res = await fetch(`${h.relayUrl}/v1/dev/pushes`);
    const { pushes } = (await res.json()) as { pushes: { deviceId: string; title: string; body: string }[] };
    await h.check("the relay sent exactly one push, with no content in it", () => {
      const mine = pushes.filter((p) => p.deviceId === phone.deviceId);
      assert.equal(mine.length, 1);
      assert.deepEqual({ title: mine[0]?.title, body: mine[0]?.body }, { ...PUSH_MESSAGE });
    });

    h.step("The phone comes back: new session, sync.hello from its last cursors");
    await phone.connect();
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === ids.chatId),
        "replayed permission",
      )
    ).event as TRequested;
    await phone.call("permission.respond", {
      chatId: ids.chatId,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await h.waitSettled(ids.chatId);
    await h.pause(300);
    await h.check("every chat event arrived once, in order, with no gaps", () => {
      assert.deepEqual(phone.gaps, []);
      const topic = `chat:${ids.chatId}`;
      const desktop = h.events.filter((f) => f.topic === topic).map((f) => f.cursor);
      const mobile = phone.events.filter((f) => f.topic === topic).map((f) => f.cursor);
      assert.deepEqual(mobile, desktop);
    });

    h.step("A command repeated after a reconnect runs once");
    const cmdId = "cmd_01JE2E0FF11NE0000000000000";
    const first = await phone.call("chat.send", { chatId: ids.chatId, text: "#script:stream" }, { cmdId });
    phone.disconnect();
    await phone.connect();
    const again = await phone.call("chat.send", { chatId: ids.chatId, text: "#script:stream" }, { cmdId });
    await h.waitSettled(ids.chatId);
    await h.check("the second send returned the stored reply; one user message exists", () => {
      assert.equal(again.turnId, first.turnId);
      const users = h.events.filter(
        (f) =>
          f.event.type === "chat.item" &&
          f.event.chatId === ids.chatId &&
          f.event.item.kind === "user" &&
          f.event.item.text === "#script:stream",
      );
      assert.equal(users.length, 1);
    });
  },
};
