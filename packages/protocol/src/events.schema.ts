import { z } from "zod";

import { chatIdSchema, procIdSchema, profileIdSchema, termIdSchema, worktreeIdSchema } from "./ids.schema.js";
import {
  chatItemPatchSchema,
  chatItemSchema,
  chatStatusSchema,
  deviceSchema,
  permissionDecisionSchema,
  permissionRequestSchema,
  procSchema,
  compareSchema,
  terminalSchema,
  usageSnapshotSchema,
  worktreeSchema,
} from "./models.schema.js";

/**
 * `global`, `repo:<id>`, `chat:<id>`, `proc:<id>`, or (additive) `term:<id>` and `preview:<wsId>`.
 * Subscriptions may use `repo:*` / `chat:*`.
 */
export const topicSchema = z
  .string()
  .regex(/^(global|(repo|chat|proc|term|preview):[A-Za-z0-9_*]+)$/, "invalid topic");
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
  z.object({
    type: z.literal("proc.output"),
    procId: procIdSchema,
    chunk: z.string(),
    /** Additive: which stream the chunk came from. */
    stream: z.enum(["stdout", "stderr"]).optional(),
  }),
  /** Additive: a repo script started, exited or was stopped (topics `proc:<id>` and `repo:<id>`). */
  z.object({ type: z.literal("proc.status"), proc: procSchema }),
  /** Additive: a device was paired, seen or revoked (topic `global`). */
  z.object({ type: z.literal("device.updated"), device: deviceSchema }),
  z.object({
    type: z.literal("preview.status"),
    worktreeId: worktreeIdSchema,
    status: z.enum(["starting", "ready", "crashed", "stopped"]),
    url: z.string().optional(),
  }),
  /** Additive (Phase 5): a compare started, an entry's chat started, or a winner was picked (`repo:<id>`). */
  z.object({ type: z.literal("compare.updated"), compare: compareSchema }),
  /**
   * Additive (Phase 5e): a sealed preview WebSocket's message from the dev server, or its close
   * (topic `preview:<wsId>`; delivered live, never stored).
   */
  z.object({
    type: z.literal("preview.ws"),
    wsId: z.string(),
    data: z.string().optional(),
    binary: z.boolean().optional(),
    closed: z.boolean().optional(),
  }),
  /** Additive (Phase 5): terminal output, coalesced (topic `term:<id>`). */
  z.object({ type: z.literal("term.output"), termId: termIdSchema, data: z.string() }),
  /** Additive: a terminal opened, resized or exited (topics `term:<id>` and `repo:<id>`). */
  z.object({ type: z.literal("term.status"), terminal: terminalSchema }),
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
