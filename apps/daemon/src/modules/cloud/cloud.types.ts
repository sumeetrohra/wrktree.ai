import type { TJson, TWrite } from "@agentdeck/firebase-rest";
import type { TChat, TWorktree } from "@agentdeck/protocol";

/**
 * Where cloud history goes for the signed-in account (port, implemented by the app with
 * Firestore and Storage). Paths are relative to the account root `users/{uid}/`.
 */
export interface ICloudStore {
  readonly uid: string;
  readonly hostId: string;
  readonly hostName: string;
  commit(writes: readonly TWrite[]): Promise<void>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** What the sync reads from the rest of the daemon (port, implemented by the app). */
export interface ICloudSource {
  worktrees(): TWorktree[];
  worktree(id: string): TWorktree | null;
  repoName(repoId: string): string;
  chats(worktreeId: string): TChat[];
  chat(id: string): TChat | null;
  profileName(profileId: string): string | null;
  blob(blobId: string): { bytes: Uint8Array; mime: string } | null;
}

export type TOutboxKind = "set" | "merge" | "blob";
export type TOutboxRow = {
  key: string;
  kind: TOutboxKind;
  path: string;
  data: Record<string, TJson>;
  version: number;
};
