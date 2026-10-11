import type { TBlobRef } from "@agentdeck/protocol";

/** Where diffs are stored (the blobs module provides it). */
export interface IBlobWriter {
  put: (bytes: Buffer, mime: string) => TBlobRef;
}

/** The worktree's path jail (the files module provides it). */
export interface IPathPolicy {
  isHidden: (rel: string) => boolean;
  resolve: (path: string) => { abs: string; rel: string };
}

export type TDiffAgainst = "base" | "head";
