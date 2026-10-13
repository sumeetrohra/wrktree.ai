import { isAbsolute, relative, sep } from "node:path";

import type { TChatItem, TChatItemPatch, TDaemonEvent } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";

import type { TAcpSessionUpdate, TAcpToolCallStatus } from "#src/infra/acp/index.js";

type TPublish = (e: TDaemonEvent) => void;

const toolStatus = (s: TAcpToolCallStatus | null | undefined) =>
  s === "completed" ? "done" : s === "failed" ? "failed" : s === "in_progress" ? "running" : "pending";

const planStatus = (s: string) =>
  s === "completed" ? "done" : s === "in_progress" ? "in_progress" : "pending";

/**
 * Turns ACP `session/update` notifications into chat items and patches.
 * Streaming text is coalesced: at most one patch per `intervalMs` per chat.
 */
export class TurnMapper {
  private open: { kind: "agent_text" | "thought"; id: string; text: string; dirty: boolean } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tools = new Map<string, string>();
  private planId: string | null = null;
  private turn = "";
  /** Everything the agent said this turn (to spot a limit notice sent as the reply). */
  private said = "";

  constructor(
    private readonly chatId: string,
    private readonly root: string,
    private readonly publish: TPublish,
    private readonly intervalMs: number,
  ) {}

  startTurn(turnId: string): void {
    this.endTurn();
    this.turn = turnId;
    this.said = "";
  }

  /** The agent's text so far this turn. */
  turnText(): string {
    return this.said;
  }

  /** Flushes buffered text and forgets per-turn state. */
  endTurn(): void {
    this.closeText();
    this.tools.clear();
    this.planId = null;
  }

  private rel(p: string): string {
    if (!isAbsolute(p)) return p;
    const r = relative(this.root, p);
    return r.startsWith("..") ? p : r.split(sep).join("/");
  }

  private item(item: TChatItem): void {
    this.publish({ type: "chat.item", chatId: this.chatId, item });
  }

  private flushText(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.open?.dirty) {
      this.open.dirty = false;
      this.publish({
        type: "chat.itemPatch",
        chatId: this.chatId,
        itemId: this.open.id,
        patch: { text: this.open.text },
      });
    }
  }

  private closeText(): void {
    this.flushText();
    this.open = null;
  }

  private appendText(kind: "agent_text" | "thought", text: string): void {
    if (kind === "agent_text") this.said += text;
    if (this.open && this.open.kind !== kind) this.closeText();
    if (!this.open) {
      this.open = { kind, id: newId("item"), text, dirty: false };
      this.item({ kind, id: this.open.id, at: now(), text });
      return;
    }
    this.open.text += text;
    this.open.dirty = true;
    this.timer ??= setTimeout(() => {
      this.flushText();
    }, this.intervalMs);
  }

  handle(update: TAcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const kind = update.sessionUpdate === "agent_message_chunk" ? "agent_text" : "thought";
        const c = update.content;
        this.appendText(kind, c.type === "text" ? c.text : `[${c.type}]`);
        return;
      }
      case "tool_call": {
        this.closeText();
        const id = `${this.turn}:${update.toolCallId}`;
        this.tools.set(update.toolCallId, id);
        this.item({
          kind: "tool",
          id,
          at: now(),
          title: update.title,
          toolKind: update.kind ?? "other",
          status: toolStatus(update.status),
          locations: (update.locations ?? []).map((l) => this.rel(l.path)),
        });
        return;
      }
      case "tool_call_update": {
        const id = this.tools.get(update.toolCallId);
        if (!id) return;
        this.closeText();
        const patch: TChatItemPatch = {};
        if (update.status) patch.status = toolStatus(update.status);
        if (update.title) patch.title = update.title;
        if (update.locations) patch.locations = update.locations.map((l) => this.rel(l.path));
        if (Object.keys(patch).length)
          this.publish({ type: "chat.itemPatch", chatId: this.chatId, itemId: id, patch });
        return;
      }
      case "plan": {
        this.closeText();
        const entries = update.entries.map(
          (e) => ({ text: e.content, status: planStatus(e.status) }) as const,
        );
        if (this.planId) {
          this.publish({
            type: "chat.itemPatch",
            chatId: this.chatId,
            itemId: this.planId,
            patch: { entries },
          });
        } else {
          this.planId = newId("item");
          this.item({ kind: "plan", id: this.planId, at: now(), entries: [...entries] });
        }
        return;
      }
      default:
        return;
    }
  }
}
