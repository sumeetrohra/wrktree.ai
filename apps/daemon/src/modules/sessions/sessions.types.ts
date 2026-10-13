import type { TBlobRef, TProfile, TWorktree } from "@agentdeck/protocol";

import type { IAgentFiles } from "#src/infra/acp/index.js";
import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

/** Profiles and how to run their agents (the profiles module provides it). */
export interface IProfileSource {
  get: (id: string) => TProfile;
  spec: (agent: string) => TAgentSpec;
  env: (profileId: string) => Record<string, string>;
}

/** Worktrees (the worktrees module provides it). */
export interface IWorktreeSource {
  get: (id: string) => TWorktree;
}

/** Attachments (the blobs module provides it). */
export interface IBlobReader {
  get: (blobId: string) => { ref: TBlobRef; bytes: Buffer };
}

/** An agent's view of one worktree's files, jailed (the files module provides it). */
export interface IWorktreeFiles {
  filesFor: (worktreeId: string) => IAgentFiles;
}

/** Where turns and limits are counted (the usage module provides it). */
export interface IUsageSink {
  /** A turn ended normally; `usage` is the session's cumulative tokens when the agent reports them. */
  turnEnded: (
    profileId: string,
    chatId: string,
    usage: { inputTokens: number; outputTokens: number } | null,
  ) => void;
  limitHit: (profileId: string, resetAt?: number) => void;
  /** The reset time passed. */
  lifted: (profileId: string) => void;
}

export type TSessionDeps = {
  profiles: IProfileSource;
  worktrees: IWorktreeSource;
  blobs: IBlobReader;
  files: IWorktreeFiles;
  usage: IUsageSink;
};

export type TPermissionDecision = "allow_once" | "allow_always" | "deny";
