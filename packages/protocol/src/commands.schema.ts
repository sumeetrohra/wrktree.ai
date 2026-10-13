import { z } from "zod";

import {
  chatIdSchema,
  deviceIdSchema,
  procIdSchema,
  profileIdSchema,
  repoIdSchema,
  worktreeIdSchema,
} from "./ids.schema.js";
import {
  blobRefSchema,
  chatSchema,
  codeContextSchema,
  deviceSchema,
  diffFileSchema,
  fsEntrySchema,
  gitStatusSchema,
  permissionDecisionSchema,
  procSchema,
  profileSchema,
  usageSnapshotSchema,
  pullRequestSchema,
  repoSchema,
  worktreeSchema,
} from "./models.schema.js";

const Empty = z.object({});

const accountLinkSchema = z.object({ code: z.string(), url: z.string(), expiresAt: z.number() });
const accountStatusSchema = z.discriminatedUnion("state", [
  /** No relay configured: local only. */
  z.object({ state: z.literal("local") }),
  z.object({ state: z.literal("unlinked") }),
  /** Deprecated (Phase 3a: computers sign in instead of showing a link code). */
  z.object({ state: z.literal("linking"), ...accountLinkSchema.shape }),
  /** Additive: a sign-in link was emailed to `email`; waiting for `account.completeSignIn`. */
  z.object({ state: z.literal("awaitingLink"), email: z.string() }),
  z.object({ state: z.literal("linked"), email: z.string().nullable() }),
]);
export type TAccountStatus = z.infer<typeof accountStatusSchema>;
/** A git branch or ref from a client: never empty, never readable as a git option (SEC5). */
const gitRefSchema = z
  .string()
  .min(1)
  .max(250)
  .refine((v) => !v.startsWith("-"), "must not start with '-'");

const WorktreeArgs = z.object({ worktreeId: worktreeIdSchema });

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

  "repo.list": { args: Empty, result: z.array(repoSchema) },
  "repo.add": { args: z.object({ path: z.string() }), result: repoSchema },
  "repo.remove": { args: z.object({ repoId: repoIdSchema }), result: Empty },

  "fs.browse": {
    args: z.object({ root: z.literal("allowlist"), path: z.string().optional() }),
    result: z.object({
      path: z.string().nullable(),
      entries: z.array(z.object({ name: z.string(), path: z.string(), isGitRepo: z.boolean() })),
    }),
  },

  "profile.list": { args: z.object({ agent: z.string().optional() }), result: z.array(profileSchema) },
  "profile.create": {
    args: z.object({ agent: z.string(), name: z.string().min(1), color: z.string().optional() }),
    result: profileSchema,
  },
  "profile.remove": { args: z.object({ profileId: profileIdSchema }), result: Empty },
  /**
   * Additive (Phase 4a): a profile's usage on this computer: whether it is at its limit and when
   * that resets, and today's tokens (where the agent reports them).
   */
  "profile.usage": { args: z.object({ profileId: profileIdSchema }), result: usageSnapshotSchema },
  "profile.loginStatus": {
    args: z.object({ profileId: profileIdSchema }),
    result: z.object({ loggedIn: z.boolean(), account: z.string().optional() }),
  },
  /** Additive: the command and env a desktop terminal runs to log this profile in. */
  "profile.loginCommand": {
    args: z.object({ profileId: profileIdSchema }),
    result: z.object({ command: z.array(z.string()), env: z.record(z.string(), z.string()) }),
  },

  "worktree.list": { args: z.object({ repoId: repoIdSchema }), result: z.array(worktreeSchema) },
  "worktree.create": {
    args: z.object({
      repoId: repoIdSchema,
      baseRef: gitRefSchema.optional(),
      branch: gitRefSchema,
      title: z.string(),
    }),
    result: worktreeSchema,
  },
  "worktree.archive": { args: WorktreeArgs, result: worktreeSchema },
  "worktree.restore": { args: WorktreeArgs, result: worktreeSchema },
  "worktree.delete": { args: WorktreeArgs, result: Empty },

  /** Additive: chats of a worktree, for clients that reconnect. */
  "chat.list": { args: WorktreeArgs, result: z.array(chatSchema) },
  "chat.create": {
    args: z.object({
      worktreeId: worktreeIdSchema,
      agent: z.string(),
      profileId: profileIdSchema,
      mode: z.string().optional(),
      model: z.string().optional(),
      title: z.string().optional(),
    }),
    result: chatSchema,
  },
  "chat.send": {
    args: z.object({
      chatId: chatIdSchema,
      text: z.string(),
      attachments: z.array(blobRefSchema).optional(),
      /** Additive: worktree file lines quoted into the prompt. */
      context: z.array(codeContextSchema).max(20).optional(),
    }),
    result: z.object({ turnId: z.string(), queued: z.boolean() }),
  },
  "chat.cancel": { args: z.object({ chatId: chatIdSchema }), result: Empty },
  /** Additive: user retry from `crashed`. */
  "chat.retry": { args: z.object({ chatId: chatIdSchema }), result: chatSchema },
  /**
   * Additive (Phase 4b): continue a chat on another profile (or agent, or model) in the same
   * worktree. The new chat starts with a hand-off brief built without a model call (transcript,
   * last plan, the worktree's changes, a pending approval) and the old chat's unsent messages.
   */
  "chat.handoff": {
    args: z.object({
      chatId: chatIdSchema,
      profileId: profileIdSchema,
      /** Must match the profile's agent when given. */
      agent: z.string().optional(),
      model: z.string().optional(),
    }),
    result: chatSchema,
  },

  "permission.respond": {
    args: z.object({
      chatId: chatIdSchema,
      requestId: z.string(),
      decision: permissionDecisionSchema,
      message: z.string().optional(),
    }),
    result: Empty,
  },

  "diff.summary": {
    args: z.object({ worktreeId: worktreeIdSchema, against: z.enum(["base", "head"]).optional() }),
    result: z.object({ against: z.string(), files: z.array(diffFileSchema) }),
  },
  "diff.file": {
    args: z.object({
      worktreeId: worktreeIdSchema,
      path: z.string(),
      against: z.enum(["base", "head"]).optional(),
    }),
    result: z.object({ blob: blobRefSchema }),
  },

  "fs.tree": {
    args: z.object({ worktreeId: worktreeIdSchema, path: z.string().optional() }),
    result: z.object({ entries: z.array(fsEntrySchema) }),
  },
  "fs.read": {
    args: z.object({
      worktreeId: worktreeIdSchema,
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
    args: z.object({ worktreeId: worktreeIdSchema, query: z.string().min(1) }),
    result: z.object({
      matches: z.array(z.object({ path: z.string(), line: z.number().int(), text: z.string() })),
      truncated: z.boolean(),
    }),
  },

  /** Upload: send blob frames under `uploadId` first, then this command. */
  "blob.put": {
    args: z.object({ mime: z.string(), size: z.number().int().nonnegative(), uploadId: z.string() }),
    result: blobRefSchema,
  },
  /** Additive: download a stored blob (large replies travel as blob frames). */
  "blob.get": {
    args: z.object({ blobId: z.string() }),
    result: z.object({ blob: blobRefSchema, base64: z.string() }),
  },

  "device.list": { args: Empty, result: z.array(deviceSchema) },
  /**
   * Deprecated (Phase 2c replaced pairing with signing in): always fails with UNAUTHORIZED. Kept so
   * the protocol stays additive.
   */
  "pair.start": {
    args: Empty,
    result: z.object({ pairingId: z.string(), link: z.string(), expiresAt: z.number() }),
  },
  /** Deprecated, see `pair.start`. */
  "pair.status": {
    args: z.object({ pairingId: z.string() }),
    result: z.object({
      state: z.enum(["waiting", "confirm", "paired", "rejected", "expired"]),
      shortCode: z.string().optional(),
      deviceId: deviceIdSchema.optional(),
      deviceName: z.string().optional(),
    }),
  },
  /** Deprecated, see `pair.start`. */
  "pair.confirm": { args: z.object({ pairingId: z.string(), accept: z.boolean() }), result: Empty },
  /**
   * Additive, local only: a link that opens the desktop web UI. It carries a one-time code (60 s)
   * the page trades for the local token; null when no web build is configured.
   */
  "web.open": { args: Empty, result: z.object({ url: z.string().nullable() }) },
  /** Additive: whether the daemon is connected to its relay. */
  "relay.status": {
    args: Empty,
    result: z.object({
      configured: z.boolean(),
      url: z.string().nullable(),
      connected: z.boolean(),
      deviceId: z.string().nullable(),
    }),
  },
  /** Removes a device from the account (on the relay); every host stops trusting it. */
  "device.revoke": { args: z.object({ deviceId: deviceIdSchema }), result: deviceSchema },

  /** Deprecated (Phase 3a: computers sign in with `account.signIn`); always fails. */
  "account.link": { args: Empty, result: accountLinkSchema },
  /**
   * Additive, local only: sign this computer in to Firebase. Emails a sign-in link to `email`;
   * finish with `account.completeSignIn`.
   */
  "account.signIn": { args: z.object({ email: z.email() }), result: Empty },
  /** Additive, local only: the link from the email. Registers this computer on the account. */
  "account.completeSignIn": { args: z.object({ link: z.string().min(1) }), result: accountStatusSchema },
  /**
   * Additive, local only, dev relays: sign in as `uid` (the relay's dev issuer, or the Firebase
   * Auth emulator as `<uid>@example.com`).
   */
  "account.signInDev": {
    args: z.object({ uid: z.string().regex(/^[\w.@+-]{1,128}$/) }),
    result: accountStatusSchema,
  },
  /** Additive: whether this host is linked, and to which account. */
  "account.status": { args: Empty, result: accountStatusSchema },
  /** Additive, local only: unlink this host: it leaves the account and forgets its device token. */
  "account.logout": { args: Empty, result: Empty },
  /**
   * Additive: everything this host is working on, in one call: repos, their worktrees (branches),
   * chats (agent, profile, model, status) and profiles. Clients merge one per host.
   */
  "workspace.overview": {
    args: Empty,
    result: z.object({
      host: z.object({ deviceId: deviceIdSchema.nullable(), name: z.string() }),
      repos: z.array(repoSchema),
      worktrees: z.array(worktreeSchema),
      chats: z.array(chatSchema),
      profiles: z.array(profileSchema),
    }),
  },

  /** Additive (Phase 3b): branch, upstream, ahead/behind, uncommitted files, last commit. */
  "git.status": { args: WorktreeArgs, result: gitStatusSchema },
  /** Additive: commit on the worktree's branch (`all`: stage every change first). */
  "git.commit": {
    args: z.object({
      worktreeId: worktreeIdSchema,
      message: z.string().trim().min(1).max(10_000),
      all: z.boolean().optional(),
    }),
    result: z.object({ sha: z.string() }),
  },
  /** Additive: push the worktree's branch to `origin`, setting the upstream. */
  "git.push": { args: WorktreeArgs, result: z.object({ branch: z.string(), remote: z.string() }) },
  /** Additive: merge the worktree's branch into the repo's base checkout (repos without GitHub). */
  "worktree.mergeToBase": { args: WorktreeArgs, result: z.object({ sha: z.string() }) },

  /** Additive: the branch's pull request (through `gh` on the computer), or null. */
  "pr.status": { args: WorktreeArgs, result: pullRequestSchema.nullable() },
  "pr.create": {
    args: z.object({
      worktreeId: worktreeIdSchema,
      title: z.string().trim().min(1).max(300),
      body: z.string().max(60_000),
      draft: z.boolean().optional(),
    }),
    result: pullRequestSchema,
  },
  "pr.merge": {
    args: z.object({ worktreeId: worktreeIdSchema, method: z.enum(["merge", "squash", "rebase"]) }),
    result: pullRequestSchema,
  },
  /** Additive: asks the chat's agent for a PR title and body; resolves when its turn ends. */
  "pr.draft": {
    args: z.object({ chatId: chatIdSchema }),
    result: z.object({ title: z.string(), body: z.string() }),
  },

  /** Additive: the repo's scripts (`.agentdeck/config.json` `scripts`) and their processes here. */
  "proc.list": {
    args: WorktreeArgs,
    result: z.object({ scripts: z.array(z.string()), procs: z.array(procSchema) }),
  },
  /** Additive: run a script by name (never an arbitrary command). Output streams on `proc:<id>`. */
  "proc.start": {
    args: z.object({ worktreeId: worktreeIdSchema, script: z.string().min(1).max(100) }),
    result: procSchema,
  },
  "proc.stop": { args: z.object({ procId: procIdSchema }), result: procSchema },
  /**
   * Additive: the last megabyte of a process's output, as a blob, and the `proc:<id>` cursor it
   * covers: follow live output with `sync.hello` from that cursor.
   */
  "proc.output": {
    args: z.object({ procId: procIdSchema }),
    result: z.object({ blob: blobRefSchema, cursor: z.number().int().nonnegative() }),
  },

  /**
   * Additive (Phase 3c): run the repo's preview script and open a tunnel to it. Remote devices get a
   * relay URL plus a one-time key (load `url?k=key` once); this computer gets `localhost`.
   */
  "preview.start": {
    args: WorktreeArgs,
    result: z.object({ url: z.string(), key: z.string().nullable(), expiresAt: z.number().nullable() }),
  },
  "preview.stop": { args: WorktreeArgs, result: Empty },

  /** Additive, local only: open the worktree (at a file and line) in a desktop editor. */
  "editor.open": {
    args: z.object({
      worktreeId: worktreeIdSchema,
      path: z.string().optional(),
      line: z.number().int().positive().optional(),
      editor: z.enum(["vscode", "cursor", "zed"]),
    }),
    result: Empty,
  },
} as const;

export type TCommands = typeof commands;
export type TCommandName = keyof TCommands;
export type TCommandArgs<N extends TCommandName> = z.input<TCommands[N]["args"]>;
export type TCommandResult<N extends TCommandName> = z.infer<TCommands[N]["result"]>;

export const commandNames: readonly TCommandName[] = Object.keys(commands).filter(isCommandName);

export function isCommandName(name: string): name is TCommandName {
  return Object.hasOwn(commands, name);
}

/*
 * TypeScript can't correlate `commands[N]` with a generic `N` (indexing a const map with a generic
 * key yields the union of every schema), so these two helpers re-associate the zod-validated value
 * with `N`. They are the only place in the codebase that needs this assertion.
 */

/** Validates a command's args; throws the zod error on mismatch. */
export function parseCommandArgs<N extends TCommandName>(
  name: N,
  args: unknown,
): z.output<TCommands[N]["args"]> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- reason: correlated-union limitation; value is zod-validated
  return commands[name].args.parse(args) as z.output<TCommands[N]["args"]>;
}

/** Validates a command's reply data; throws the zod error on mismatch. */
export function parseCommandResult<N extends TCommandName>(name: N, data: unknown): TCommandResult<N> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- reason: correlated-union limitation; value is zod-validated
  return commands[name].result.parse(data) as TCommandResult<N>;
}
