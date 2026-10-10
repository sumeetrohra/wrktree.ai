import { z } from "zod";
import { ChatId, ProfileId, RepoId, WorktreeId } from "./ids.js";

export const BlobRef = z.object({
  blobId: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
});
export type BlobRef = z.infer<typeof BlobRef>;

export const Repo = z.object({
  id: RepoId,
  path: z.string(),
  name: z.string(),
  defaultBase: z.string(),
  createdAt: z.number(),
});
export type Repo = z.infer<typeof Repo>;

export const Profile = z.object({
  id: ProfileId,
  agent: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.number(),
});
export type Profile = z.infer<typeof Profile>;

export const WorktreeStatus = z.enum(["creating", "setting_up", "ready", "setup_failed", "archived"]);
export type WorktreeStatus = z.infer<typeof WorktreeStatus>;

export const Worktree = z.object({
  id: WorktreeId,
  repoId: RepoId,
  title: z.string(),
  branch: z.string(),
  baseRef: z.string(),
  /** Absolute path on the daemon's machine. */
  path: z.string(),
  status: WorktreeStatus,
  port: z.number().int().nullable(),
  /** Last lines of setup output when status is `setup_failed`. */
  setupError: z.string().nullable(),
  createdAt: z.number(),
  archivedAt: z.number().nullable(),
});
export type Worktree = z.infer<typeof Worktree>;

export const ChatStatus = z.enum([
  "starting",
  "idle",
  "running",
  "awaiting_permission",
  "limited",
  "crashed",
  "stopped",
]);
export type ChatStatus = z.infer<typeof ChatStatus>;

export const Chat = z.object({
  id: ChatId,
  worktreeId: WorktreeId,
  agent: z.string(),
  profileId: ProfileId,
  title: z.string().nullable(),
  status: ChatStatus,
  /** True once the chat was restarted without `session/load` and seeded from a summary. */
  resumed: z.boolean(),
  /** Messages waiting for the current turn to end. */
  queued: z.number().int().nonnegative(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Chat = z.infer<typeof Chat>;

export const PermissionOption = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]),
});

export const PermissionRequest = z.object({
  requestId: z.string(),
  toolCallId: z.string(),
  title: z.string(),
  toolKind: z.string(),
  /** Paths relative to the worktree root. */
  locations: z.array(z.string()),
  options: z.array(PermissionOption),
  at: z.number(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const PermissionDecision = z.enum(["allow_once", "allow_always", "deny"]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;

export const UsageSnapshot = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  limitHit: z.boolean(),
  resetAt: z.number().optional(),
});
export type UsageSnapshot = z.infer<typeof UsageSnapshot>;

const itemBase = { id: z.string(), at: z.number() };

export const ToolStatus = z.enum(["pending", "running", "done", "failed"]);
export const PlanEntryStatus = z.enum(["pending", "in_progress", "done"]);

export const ChatItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), ...itemBase, text: z.string(), attachments: z.array(BlobRef) }),
  z.object({ kind: z.literal("agent_text"), ...itemBase, text: z.string() }),
  z.object({ kind: z.literal("thought"), ...itemBase, text: z.string() }),
  z.object({
    kind: z.literal("tool"),
    ...itemBase,
    title: z.string(),
    toolKind: z.string(),
    status: ToolStatus,
    locations: z.array(z.string()).optional(),
    diff: BlobRef.optional(),
  }),
  z.object({
    kind: z.literal("plan"),
    ...itemBase,
    entries: z.array(z.object({ text: z.string(), status: PlanEntryStatus })),
  }),
  z.object({
    kind: z.literal("system"),
    ...itemBase,
    text: z.string(),
    level: z.enum(["info", "warn", "error"]),
  }),
]);
export type ChatItem = z.infer<typeof ChatItem>;

export const DiffFile = z.object({
  path: z.string(),
  added: z.number().int(),
  removed: z.number().int(),
  status: z.enum(["modified", "added", "deleted", "untracked", "binary"]),
});
export type DiffFile = z.infer<typeof DiffFile>;

export const FsEntry = z.object({
  name: z.string(),
  /** Relative to the worktree (or browse root). */
  path: z.string(),
  type: z.enum(["file", "dir"]),
  size: z.number().int().optional(),
});
export type FsEntry = z.infer<typeof FsEntry>;
