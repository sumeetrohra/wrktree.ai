import { z } from "zod";

import {
  chatIdSchema,
  deviceIdSchema,
  procIdSchema,
  profileIdSchema,
  repoIdSchema,
  worktreeIdSchema,
} from "./ids.schema.js";

export const blobRefSchema = z.object({
  blobId: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});
export type TBlobRef = z.infer<typeof blobRefSchema>;

export const repoSchema = z.object({
  id: repoIdSchema,
  path: z.string(),
  name: z.string(),
  defaultBase: z.string(),
  createdAt: z.number(),
});
export type TRepo = z.infer<typeof repoSchema>;

export const profileSchema = z.object({
  id: profileIdSchema,
  agent: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.number(),
});
export type TProfile = z.infer<typeof profileSchema>;

export const worktreeStatusSchema = z.enum(["creating", "setting_up", "ready", "setup_failed", "archived"]);
export type TWorktreeStatus = z.infer<typeof worktreeStatusSchema>;

export const worktreeSchema = z.object({
  id: worktreeIdSchema,
  repoId: repoIdSchema,
  title: z.string(),
  branch: z.string(),
  baseRef: z.string(),
  /** Absolute path on the daemon's machine. */
  path: z.string(),
  status: worktreeStatusSchema,
  port: z.number().int().nullable(),
  /** Last lines of setup output when status is `setup_failed`. */
  setupError: z.string().nullable(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
});
export type TWorktree = z.infer<typeof worktreeSchema>;

export const chatStatusSchema = z.enum([
  "starting",
  "idle",
  "running",
  "awaiting_permission",
  "limited",
  "crashed",
  "stopped",
]);
export type TChatStatus = z.infer<typeof chatStatusSchema>;

export const chatSchema = z.object({
  id: chatIdSchema,
  worktreeId: worktreeIdSchema,
  agent: z.string(),
  profileId: profileIdSchema,
  title: z.string().nullable(),
  status: chatStatusSchema,
  /** True once the chat was restarted without `session/load` and seeded from a summary. */
  resumed: z.boolean(),
  /** Messages waiting for the current turn to end. */
  queued: z.number().int().nonnegative(),
  /** Additive: the model asked for at `chat.create`, null for the agent's default. */
  model: z.string().nullable().optional(),
  /** Additive (Phase 4b): the chat this one continues (`chat.handoff`). */
  handedOffFrom: chatIdSchema.nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TChat = z.infer<typeof chatSchema>;

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

export const permissionRequestSchema = z.object({
  requestId: z.string(),
  toolCallId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  /** Paths relative to the worktree root. */
  locations: z.array(z.string()),
  options: z.array(permissionOptionSchema),
  at: z.number(),
});
export type TPermissionRequest = z.infer<typeof permissionRequestSchema>;

export const permissionDecisionSchema = z.enum(["allow_once", "allow_always", "deny"]);
export type TPermissionDecision = z.infer<typeof permissionDecisionSchema>;

/** A profile's usage. Tokens are today's (local time) on this computer, where the agent reports them. */
export const usageSnapshotSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  limitHit: z.boolean(),
  resetAt: z.number().optional(),
  /** Additive (Phase 4a): when the limit was hit. */
  limitedAt: z.number().optional(),
});
export type TUsageSnapshot = z.infer<typeof usageSnapshotSchema>;

const itemBase = { id: z.string(), at: z.number() };

export const toolStatusSchema = z.enum(["pending", "running", "done", "failed"]);
export const planEntryStatusSchema = z.enum(["pending", "in_progress", "done"]);

export const planEntrySchema = z.object({ text: z.string(), status: planEntryStatusSchema });
export type TPlanEntry = z.infer<typeof planEntrySchema>;

/** Lines of a worktree file quoted into a prompt ("ask the agent about these lines"). */
export const codeContextSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
});
export type TCodeContext = z.infer<typeof codeContextSchema>;

export const chatItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    ...itemBase,
    text: z.string(),
    attachments: z.array(blobRefSchema),
    /** Additive: file lines quoted with the message. */
    context: z.array(codeContextSchema).optional(),
  }),
  z.object({ kind: z.literal("agent_text"), ...itemBase, text: z.string() }),
  z.object({ kind: z.literal("thought"), ...itemBase, text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    ...itemBase,
    title: z.string(),
    toolKind: z.string(),
    status: toolStatusSchema,
    locations: z.array(z.string()).optional(),
    diff: blobRefSchema.optional(),
  }),
  z.object({
    kind: z.literal("plan"),
    ...itemBase,
    entries: z.array(planEntrySchema),
  }),
  z.object({
    kind: z.literal("system"),
    ...itemBase,
    text: z.string(),
    level: z.enum(["info", "warn", "error"]),
  }),
]);
export type TChatItem = z.infer<typeof chatItemSchema>;

export const diffFileSchema = z.object({
  path: z.string(),
  added: z.number().int(),
  removed: z.number().int(),
  status: z.enum(["modified", "added", "deleted", "untracked", "binary"]),
});
export type TDiffFile = z.infer<typeof diffFileSchema>;

export const fsEntrySchema = z.object({
  name: z.string(),
  /** Relative to the worktree (or browse root). */
  path: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number().int().optional(),
});
export type TFsEntry = z.infer<typeof fsEntrySchema>;

/** The fields a `chat.itemPatch` may change on an existing item. */
export const chatItemPatchSchema = z.object({
  text: z.string().optional(),
  status: toolStatusSchema.optional(),
  title: z.string().optional(),
  locations: z.array(z.string()).optional(),
  entries: z.array(planEntrySchema).optional(),
});
export type TChatItemPatch = z.infer<typeof chatItemPatchSchema>;

export const deviceKindSchema = z.enum(["phone", "daemon", "web"]);
export type TDeviceKind = z.infer<typeof deviceKindSchema>;

/**
 * A device on the daemon's account: hosts (`daemon`) and consumers (`phone`, `web`). `pairedAt` is
 * when it joined the account.
 */
export const deviceSchema = z.object({
  id: deviceIdSchema,
  name: z.string(),
  kind: deviceKindSchema,
  pairedAt: z.number(),
  lastSeenAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  /** Additive: connected to the relay right now. */
  connected: z.boolean().optional(),
  /** Additive: this is the daemon answering. */
  self: z.boolean().optional(),
});
export type TDevice = z.infer<typeof deviceSchema>;

/** A repo script (`.agentdeck/config.json` `scripts`) running in a worktree. */
export const procStatusSchema = z.enum(["running", "exited", "crashed", "stopped"]);
export const procSchema = z.object({
  id: procIdSchema,
  worktreeId: worktreeIdSchema,
  script: z.string(),
  status: procStatusSchema,
  exitCode: z.number().int().nullable(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
});
export type TProc = z.infer<typeof procSchema>;

/** The pull request of a worktree's branch, as `gh` reports it. */
export const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  draft: z.boolean(),
});
export type TPullRequest = z.infer<typeof pullRequestSchema>;

export const gitStatusSchema = z.object({
  branch: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  /** Changed or untracked files. */
  dirty: z.number().int().nonnegative(),
  lastCommit: z.object({ sha: z.string(), subject: z.string(), at: z.number() }).nullable(),
  hasRemote: z.boolean(),
});
export type TGitStatus = z.infer<typeof gitStatusSchema>;
