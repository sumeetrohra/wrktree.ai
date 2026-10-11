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

export type TSessionDeps = {
  profiles: IProfileSource;
  worktrees: IWorktreeSource;
  blobs: IBlobReader;
  files: IWorktreeFiles;
};

export type TPermissionDecision = "allow_once" | "allow_always" | "deny";
