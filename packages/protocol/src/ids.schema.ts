import { z } from "zod";

const prefixed = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`), `expected a ${prefix}_ id`);

export const repoIdSchema = prefixed("repo");
export const profileIdSchema = prefixed("prof");
export const worktreeIdSchema = prefixed("wt");
export const chatIdSchema = prefixed("chat");
/** Client-generated ULID; repeating one returns the stored result instead of running again. */
export const cmdIdSchema = prefixed("cmd");
export const deviceIdSchema = z.string().min(1);
export const procIdSchema = z.string().min(1);
/** Additive (Phase 5): one task given to several agents side by side. */
export const compareIdSchema = z.string().min(1);
/** Additive (Phase 5): a terminal on the computer. */
export const termIdSchema = z.string().min(1);
/** sha256 hex of the blob's bytes, or a client upload id while a blob is in flight. */
export const blobIdSchema = z.string().min(1);

export type TRepoId = z.infer<typeof repoIdSchema>;
export type TProfileId = z.infer<typeof profileIdSchema>;
export type TWorktreeId = z.infer<typeof worktreeIdSchema>;
export type TChatId = z.infer<typeof chatIdSchema>;
export type TCmdId = z.infer<typeof cmdIdSchema>;
export type TDeviceId = z.infer<typeof deviceIdSchema>;
export type TProcId = z.infer<typeof procIdSchema>;
export type TTermId = z.infer<typeof termIdSchema>;
export type TCompareId = z.infer<typeof compareIdSchema>;
