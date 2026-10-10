import { z } from "zod";

const prefixed = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `expected a ${prefix}_ id`);

export const RepoId = prefixed("repo");
export const ProfileId = prefixed("prof");
export const WorktreeId = prefixed("wt");
export const ChatId = prefixed("chat");
/** Client-generated ULID; repeating one returns the stored result instead of running again. */
export const CmdId = prefixed("cmd");
export const DeviceId = z.string().min(1);
export const ProcId = z.string().min(1);
/** sha256 hex of the blob's bytes, or a client upload id while a blob is in flight. */
export const BlobId = z.string().min(1);

export type RepoId = z.infer<typeof RepoId>;
export type ProfileId = z.infer<typeof ProfileId>;
export type WorktreeId = z.infer<typeof WorktreeId>;
export type ChatId = z.infer<typeof ChatId>;
export type CmdId = z.infer<typeof CmdId>;
export type DeviceId = z.infer<typeof DeviceId>;
export type ProcId = z.infer<typeof ProcId>;
