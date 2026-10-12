import type { TEvtFrame } from "@agentdeck/protocol";

import { chatNeedingAttention, chatView, useChatsStore } from "./chat.store";

const CHAT = "chat_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";
let cursor = 0;
const evt = (event: TEvtFrame["event"]): TEvtFrame => ({
  t: "evt",
  topic: `chat:${CHAT}`,
  cursor: ++cursor,
  event,
});

describe("chat store", () => {
  it("appends items, applies streaming patches, tracks status and the pending permission", () => {
    const apply = (e: TEvtFrame): void => {
      useChatsStore.getState().apply("d_host", e);
    };
    apply(
      evt({ type: "chat.item", chatId: CHAT, item: { kind: "agent_text", id: "i1", at: 1, text: "Hel" } }),
    );
    apply(evt({ type: "chat.itemPatch", chatId: CHAT, itemId: "i1", patch: { text: "Hello" } }));
    apply(evt({ type: "chat.status", chatId: CHAT, status: "awaiting_permission" }));
    apply(
      evt({
        type: "permission.requested",
        chatId: CHAT,
        request: {
          requestId: "r1",
          toolCallId: "t1",
          title: "Edit app.ts",
          toolKind: "edit",
          locations: ["app.ts"],
          options: [],
          at: 5,
        },
      }),
    );
    let v = chatView(CHAT);
    expect(v.order).toEqual(["i1"]);
    expect(v.items["i1"]).toMatchObject({ text: "Hello" });
    expect(v.status).toBe("awaiting_permission");
    expect(v.pending?.requestId).toBe("r1");
    expect(chatNeedingAttention()).toEqual({ chatId: CHAT, hostId: "d_host" });

    apply(
      evt({
        type: "permission.resolved",
        chatId: CHAT,
        requestId: "r1",
        decision: "allow_once",
        auto: false,
      }),
    );
    v = chatView(CHAT);
    expect(v.pending).toBeNull();
    expect(chatNeedingAttention()).toBeNull();
  });

  it("re-delivering an item replaces it instead of duplicating it", () => {
    const apply = (e: TEvtFrame): void => {
      useChatsStore.getState().apply("d_host", e);
    };
    apply(
      evt({ type: "chat.item", chatId: CHAT, item: { kind: "agent_text", id: "i1", at: 1, text: "Again" } }),
    );
    expect(chatView(CHAT).order.filter((id) => id === "i1")).toHaveLength(1);
  });
});
