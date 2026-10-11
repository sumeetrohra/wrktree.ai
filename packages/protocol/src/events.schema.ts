import { z } from "zod";

import { chatIdSchema, procIdSchema, profileIdSchema, worktreeIdSchema } from "./ids.schema.js";
import {
  chatItemPatchSchema,
  chatItemSchema,
  chatStatusSchema,
  permissionDecisionSchema,
  permissionRequestSchema,
  usageSnapshotSchema,
  worktreeSchema,
} from "./models.schema.js";

/** `global`, `repo:<id>`, `chat:<id>` or `proc:<id>`. Subscriptions may use `repo:*` / `chat:*`. */
export const topicSchema = z.string().regex(/^(global|(repo|chat|proc):[A-Za-z0-9_*]+)$/, "invalid topic");
export type TTopic = z.infer<typeof topicSchema>;

export const daemonEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("worktree.updated"), worktree: worktreeSchema }),
  /** Additive to the spec: a deleted worktree leaves no row behind. */
  z.object({ type: z.literal("worktree.removed"), worktreeId: worktreeIdSchema }),
  z.object({
    type: z.literal("chat.status"),
    chatId: chatIdSchema,
    status: chatStatusSchema,
    queued: z.number().int().nonnegative().optional(),
    resetAt: z.number().optional(),
  }),
  z.object({ type: z.literal("chat.item"), chatId: chatIdSchema, item: chatItemSchema }),
  z.object({
    type: z.literal("chat.itemPatch"),
    chatId: chatIdSchema,
    itemId: z.string(),
    patch: chatItemPatchSchema,
  }),
  z.object({
    type: z.literal("permission.requested"),
    chatId: chatIdSchema,
    request: permissionRequestSchema,
  }),
  /** Additive to the spec: lets every client drop its permission sheet, including auto-answered requests. */
  z.object({
    type: z.literal("permission.resolved"),
    chatId: chatIdSchema,
    requestId: z.string(),
    decision: permissionDecisionSchema.or(z.literal("cancelled")),
    auto: z.boolean(),
  }),
  z.object({ type: z.literal("usage.updated"), profileId: profileIdSchema, usage: usageSnapshotSchema }),
  z.object({ type: z.literal("proc.output"), procId: procIdSchema, chunk: z.string() }),
  z.object({
    type: z.literal("preview.status"),
    worktreeId: worktreeIdSchema,
    status: z.enum(["starting", "ready", "crashed", "stopped"]),
    url: z.string().optional(),
  }),
]);
export type TDaemonEvent = z.infer<typeof daemonEventSchema>;
export type TDaemonEventType = TDaemonEvent["type"];

/** One line of a topic's JSONL event log. `cursor` is the 1-based line number. */
export const loggedEventSchema = z.object({
  topic: topicSchema,
  cursor: z.number().int().positive(),
  at: z.number(),
  event: daemonEventSchema,
});
export type TLoggedEvent = z.infer<typeof loggedEventSchema>;
