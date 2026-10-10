import type * as acp from "@agentclientprotocol/sdk";
import { AgentdeckError, type PermissionDecision, type PermissionRequest } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";
import type { Ctx } from "../../context.js";

type Pending = {
  chatId: string;
  request: PermissionRequest;
  resolve: (r: acp.RequestPermissionResponse) => void;
};

export type BrokerHooks = {
  onPending(chatId: string): void;
  onResolved(chatId: string): void;
};

function pick(
  options: acp.PermissionOption[],
  kinds: acp.PermissionOptionKind[],
): acp.PermissionOption | undefined {
  for (const k of kinds) {
    const o = options.find((opt) => opt.kind === k);
    if (o) return o;
  }
  return undefined;
}

/**
 * Answers agent permission requests from saved "allow always" rules, or parks
 * them until a client responds. Pending requests never time out: agents wait.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly ctx: Ctx,
    private readonly hooks: BrokerHooks,
  ) {}

  private pattern(request: PermissionRequest): string {
    return request.locations[0] ?? "*";
  }

  private hasRule(chatId: string, toolKind: string, pattern: string): boolean {
    return !!this.ctx.db
      .prepare("SELECT 1 FROM permission_rules WHERE chat_id = ? AND tool_kind = ? AND pattern IN (?, '*')")
      .get(chatId, toolKind, pattern);
  }

  request(chatId: string, params: acp.RequestPermissionRequest, rel: (p: string) => string) {
    const tc = params.toolCall;
    const request: PermissionRequest = {
      requestId: newId("perm"),
      toolCallId: tc.toolCallId,
      title: tc.title ?? "Permission requested",
      toolKind: tc.kind ?? "other",
      locations: (tc.locations ?? []).map((l) => rel(l.path)),
      options: params.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      at: now(),
    };
    const topic = `chat:${chatId}`;

    if (this.hasRule(chatId, request.toolKind, this.pattern(request))) {
      const opt = pick(params.options, ["allow_always", "allow_once"]);
      if (opt) {
        this.ctx.bus.publish(topic, { type: "permission.requested", chatId, request });
        this.ctx.bus.publish(topic, {
          type: "permission.resolved",
          chatId,
          requestId: request.requestId,
          decision: "allow_always",
          auto: true,
        });
        return Promise.resolve<acp.RequestPermissionResponse>({
          outcome: { outcome: "selected", optionId: opt.optionId },
        });
      }
    }

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.pending.set(request.requestId, { chatId, request, resolve });
      this.ctx.bus.publish(topic, { type: "permission.requested", chatId, request });
      this.hooks.onPending(chatId);
    });
  }

  respond(chatId: string, requestId: string, decision: PermissionDecision): void {
    const p = this.pending.get(requestId);
    if (!p || p.chatId !== chatId)
      throw new AgentdeckError("NOT_FOUND", `No pending permission request ${requestId}`);
    const opts = p.request.options as acp.PermissionOption[];
    const opt =
      decision === "allow_once"
        ? pick(opts, ["allow_once", "allow_always"])
        : decision === "allow_always"
          ? pick(opts, ["allow_always", "allow_once"])
          : pick(opts, ["reject_once", "reject_always"]);
    if (decision === "allow_always") {
      this.ctx.db
        .prepare("INSERT OR IGNORE INTO permission_rules (chat_id, tool_kind, pattern) VALUES (?, ?, ?)")
        .run(chatId, p.request.toolKind, this.pattern(p.request));
    }
    this.pending.delete(requestId);
    this.ctx.bus.publish(`chat:${chatId}`, {
      type: "permission.resolved",
      chatId,
      requestId,
      decision,
      auto: false,
    });
    p.resolve(
      opt
        ? { outcome: { outcome: "selected", optionId: opt.optionId } }
        : { outcome: { outcome: "cancelled" } },
    );
    this.hooks.onResolved(chatId);
  }

  /** Cancels every pending request of a chat (turn cancelled, agent gone). */
  cancelChat(chatId: string): void {
    for (const [id, p] of this.pending) {
      if (p.chatId !== chatId) continue;
      this.pending.delete(id);
      this.ctx.bus.publish(`chat:${chatId}`, {
        type: "permission.resolved",
        chatId,
        requestId: id,
        decision: "cancelled",
        auto: true,
      });
      p.resolve({ outcome: { outcome: "cancelled" } });
    }
  }

  pendingFor(chatId: string): PermissionRequest[] {
    return [...this.pending.values()].filter((p) => p.chatId === chatId).map((p) => p.request);
  }
}
