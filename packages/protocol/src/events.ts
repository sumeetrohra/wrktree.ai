import { z } from "zod";
import { ChatId, ProcId, ProfileId, WorktreeId } from "./ids.js";
import {
  ChatItem,
  ChatStatus,
  PermissionDecision,
  PermissionRequest,
  UsageSnapshot,
  Worktree,
} from "./models.js";

/** `global`, `repo:<id>`, `chat:<id>` or `proc:<id>`. Subscriptions may use `repo:*` / `chat:*`. */
export const Topic = z.string().regex(/^(global|(repo|chat|proc):[A-Za-z0-9_*]+)$/, "invalid topic");
export type Topic = z.infer<typeof Topic>;

export const DaemonEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worktree.updated"), worktree: Worktree }),
  /** Additive to the spec: a deleted worktree leaves no row behind. */
  z.object({ type: z.literal("worktree.removed"), worktreeId: WorktreeId }),
  z.object({
    type: z.literal("chat.status"),
    chatId: ChatId,
    status: ChatStatus,
    queued: z.number().int().nonnegative().optional(),
    resetAt: z.number().optional(),
  }),
  z.object({ type: z.literal("chat.item"), chatId: ChatId, item: ChatItem }),
  z.object({
    type: z.literal("chat.itemPatch"),
    chatId: ChatId,
    itemId: z.string(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal("permission.requested"), chatId: ChatId, request: PermissionRequest }),
  /** Additive to the spec: lets every client drop its permission sheet, including auto-answered requests. */
  z.object({
    type: z.literal("permission.resolved"),
    chatId: ChatId,
    requestId: z.string(),
    decision: PermissionDecision.or(z.literal("cancelled")),
    auto: z.boolean(),
  }),
  z.object({ type: z.literal("usage.updated"), profileId: ProfileId, usage: UsageSnapshot }),
  z.object({ type: z.literal("proc.output"), procId: ProcId, chunk: z.string() }),
  z.object({
    type: z.literal("preview.status"),
    worktreeId: WorktreeId,
    status: z.enum(["starting", "ready", "crashed", "stopped"]),
    url: z.string().optional(),
  }),
]);
export type DaemonEvent = z.infer<typeof DaemonEvent>;
export type DaemonEventType = DaemonEvent["type"];

/** One line of a topic's JSONL event log. `cursor` is the 1-based line number. */
export const LoggedEvent = z.object({
  topic: Topic,
  cursor: z.number().int().positive(),
  at: z.number(),
  event: DaemonEvent,
});
export type LoggedEvent = z.infer<typeof LoggedEvent>;
