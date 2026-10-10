import { z } from "zod";
import { ChatId, ProfileId, RepoId, WorktreeId } from "./ids.js";
import { BlobRef, Chat, DiffFile, FsEntry, PermissionDecision, Profile, Repo, Worktree } from "./models.js";

const Empty = z.object({});
const WorktreeArgs = z.object({ worktreeId: WorktreeId });

/**
 * Every command the daemon accepts: its args and the `data` of a successful reply.
 * Phase 1 covers the daemon core. Later phases only add entries (additive changes only).
 */
export const commands = {
  "sync.hello": {
    args: z.object({
      deviceName: z.string(),
      appVersion: z.string(),
      /**
       * Last cursor seen per topic. `chat:*` style keys apply to every matching topic
       * (including ones created later); an explicit topic key overrides the wildcard for that topic.
       */
      cursors: z.record(z.string(), z.number().int().nonnegative()),
    }),
    result: z.object({
      daemonId: z.string(),
      daemonVersion: z.string(),
      /** Current cursor per subscribed topic, before the replay is streamed. */
      topics: z.record(z.string(), z.number().int()),
    }),
  },

  "repo.list": { args: Empty, result: z.array(Repo) },
  "repo.add": { args: z.object({ path: z.string() }), result: Repo },
  "repo.remove": { args: z.object({ repoId: RepoId }), result: Empty },

  "fs.browse": {
    args: z.object({ root: z.literal("allowlist"), path: z.string().optional() }),
    result: z.object({
      path: z.string().nullable(),
      entries: z.array(z.object({ name: z.string(), path: z.string(), isGitRepo: z.boolean() })),
    }),
  },

  "profile.list": { args: z.object({ agent: z.string().optional() }), result: z.array(Profile) },
  "profile.create": {
    args: z.object({ agent: z.string(), name: z.string().min(1), color: z.string().optional() }),
    result: Profile,
  },
  "profile.remove": { args: z.object({ profileId: ProfileId }), result: Empty },
  "profile.loginStatus": {
    args: z.object({ profileId: ProfileId }),
    result: z.object({ loggedIn: z.boolean(), account: z.string().optional() }),
  },
  /** Additive: the command and env a desktop terminal runs to log this profile in. */
  "profile.loginCommand": {
    args: z.object({ profileId: ProfileId }),
    result: z.object({ command: z.array(z.string()), env: z.record(z.string(), z.string()) }),
  },

  "worktree.list": { args: z.object({ repoId: RepoId }), result: z.array(Worktree) },
  "worktree.create": {
    args: z.object({ repoId: RepoId, baseRef: z.string().optional(), branch: z.string(), title: z.string() }),
    result: Worktree,
  },
  "worktree.archive": { args: WorktreeArgs, result: Worktree },
  "worktree.restore": { args: WorktreeArgs, result: Worktree },
  "worktree.delete": { args: WorktreeArgs, result: Empty },

  /** Additive: chats of a worktree, for clients that reconnect. */
  "chat.list": { args: WorktreeArgs, result: z.array(Chat) },
  "chat.create": {
    args: z.object({
      worktreeId: WorktreeId,
      agent: z.string(),
      profileId: ProfileId,
      mode: z.string().optional(),
      model: z.string().optional(),
      title: z.string().optional(),
    }),
    result: Chat,
  },
  "chat.send": {
    args: z.object({ chatId: ChatId, text: z.string(), attachments: z.array(BlobRef).optional() }),
    result: z.object({ turnId: z.string(), queued: z.boolean() }),
  },
  "chat.cancel": { args: z.object({ chatId: ChatId }), result: Empty },
  /** Additive: user retry from `crashed`. */
  "chat.retry": { args: z.object({ chatId: ChatId }), result: Chat },

  "permission.respond": {
    args: z.object({
      chatId: ChatId,
      requestId: z.string(),
      decision: PermissionDecision,
      message: z.string().optional(),
    }),
    result: Empty,
  },

  "diff.summary": {
    args: z.object({ worktreeId: WorktreeId, against: z.enum(["base", "head"]).optional() }),
    result: z.object({ against: z.string(), files: z.array(DiffFile) }),
  },
  "diff.file": {
    args: z.object({
      worktreeId: WorktreeId,
      path: z.string(),
      against: z.enum(["base", "head"]).optional(),
    }),
    result: z.object({ blob: BlobRef }),
  },

  "fs.tree": {
    args: z.object({ worktreeId: WorktreeId, path: z.string().optional() }),
    result: z.object({ entries: z.array(FsEntry) }),
  },
  "fs.read": {
    args: z.object({
      worktreeId: WorktreeId,
      path: z.string(),
      offset: z.number().int().nonnegative().optional(),
      length: z.number().int().positive().optional(),
    }),
    result: z.object({
      text: z.string(),
      size: z.number().int(),
      offset: z.number().int(),
      eof: z.boolean(),
    }),
  },
  "fs.search": {
    args: z.object({ worktreeId: WorktreeId, query: z.string().min(1) }),
    result: z.object({
      matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
      truncated: z.boolean(),
    }),
  },

  /** Upload: send blob frames under `uploadId` first, then this command. */
  "blob.put": {
    args: z.object({ mime: z.string(), size: z.number().int().nonnegative(), uploadId: z.string() }),
    result: BlobRef,
  },
  /** Additive: download a stored blob (large replies travel as blob frames). */
  "blob.get": {
    args: z.object({ blobId: z.string() }),
    result: z.object({ blob: BlobRef, base64: z.string() }),
  },
} as const;

export type Commands = typeof commands;
export type CommandName = keyof Commands;
export type CommandArgs<N extends CommandName> = z.input<Commands[N]["args"]>;
export type CommandResult<N extends CommandName> = z.infer<Commands[N]["result"]>;

export const commandNames = Object.keys(commands) as CommandName[];

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commands, name);
}
