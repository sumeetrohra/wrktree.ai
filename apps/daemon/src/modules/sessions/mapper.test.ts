import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonEvent } from "@agentdeck/protocol";
import { TurnMapper } from "./mapper.js";

const chunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk" as const,
  content: { type: "text" as const, text },
});

describe("TurnMapper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces streaming text to one patch per interval", () => {
    const out: DaemonEvent[] = [];
    const m = new TurnMapper("chat_x", "/wt", (e) => out.push(e), 50);
    m.startTurn("turn_1");
    for (let i = 0; i < 100; i++) {
      m.handle(chunk(`w${i} `));
      vi.advanceTimersByTime(1);
    }
    m.endTurn();
    const patches = out.filter((e) => e.type === "chat.itemPatch");
    expect(out[0]).toMatchObject({ type: "chat.item", item: { kind: "agent_text", text: "w0 " } });
    expect(patches.length).toBeLessThanOrEqual(3);
    expect((patches.at(-1)!.patch as { text: string }).text.split(" ").filter(Boolean)).toHaveLength(100);
  });

  it("maps tool calls, updates and plans", () => {
    const out: DaemonEvent[] = [];
    const m = new TurnMapper("chat_x", "/wt", (e) => out.push(e), 50);
    m.startTurn("turn_1");
    m.handle({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Edit",
      kind: "edit",
      status: "pending",
      locations: [{ path: "/wt/src/a.ts" }],
    });
    m.handle({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
    m.handle({ sessionUpdate: "plan", entries: [{ content: "A", status: "completed", priority: "low" }] });
    m.handle({
      sessionUpdate: "plan",
      entries: [
        { content: "A", status: "completed", priority: "low" },
        { content: "B", status: "pending", priority: "low" },
      ],
    });
    expect(out[0]).toMatchObject({
      item: { kind: "tool", id: "turn_1:t1", locations: ["src/a.ts"], status: "pending" },
    });
    expect(out[1]).toMatchObject({ type: "chat.itemPatch", itemId: "turn_1:t1", patch: { status: "done" } });
    expect(out[2]).toMatchObject({ item: { kind: "plan", entries: [{ text: "A", status: "done" }] } });
    expect(out[3]).toMatchObject({
      type: "chat.itemPatch",
      patch: { entries: [{ status: "done" }, { status: "pending" }] },
    });
  });
});
