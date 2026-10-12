import { Firestore, Storage, type TDoc } from "@agentdeck/firebase-rest";
import { chatItemSchema, type TChatItem } from "@agentdeck/protocol";
import { z } from "zod";

import { auth } from "../auth";

/**
 * Cloud chat history: what every host on the account wrote to Firestore and Storage (worktrees,
 * chats, items, files), readable here even when the host is offline or the worktree was deleted.
 * Reads use the signed-in user's ID token, so Firebase's rules limit them to this account.
 */

const worktreeSchema = z.object({
  hostId: z.string(),
  worktreeId: z.string(),
  repoId: z.string(),
  repoName: z.string(),
  title: z.string(),
  branch: z.string(),
  status: z.string(),
  createdAt: z.number(),
  deletedAt: z.number().nullable().optional(),
});
export type TCloudWorktree = z.infer<typeof worktreeSchema>;

const chatSchema = z.object({
  hostId: z.string(),
  chatId: z.string(),
  worktreeId: z.string(),
  agent: z.string(),
  profileName: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  title: z.string().nullable(),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pendingPermission: z.string().nullable().optional(),
});
export type TCloudChat = z.infer<typeof chatSchema>;

const hostSchema = z.object({ name: z.string(), lastSeenAt: z.number() });
export type TCloudHost = z.infer<typeof hostSchema> & { id: string };

const fileRefSchema = z.object({ storagePath: z.string(), mime: z.string() });

/** An item as stored: the protocol's item plus its order and the Storage paths of its files. */
export type TCloudItem = { item: TChatItem; seq: number; files: { storagePath: string; mime: string }[] };

async function clients(): Promise<{ db: Firestore; files: Storage; root: string }> {
  const fb = await auth.firebase();
  const idToken = (): Promise<string> => fb.tokens.idToken();
  return {
    db: new Firestore(fb.config, idToken),
    files: new Storage(fb.config, idToken),
    root: `users/${fb.uid}`,
  };
}

function parsed<S extends z.ZodType>(schema: S, docs: readonly TDoc[]): z.infer<S>[] {
  return docs.flatMap((d) => {
    const r = schema.safeParse(d.data);
    return r.success ? [r.data] : [];
  });
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const cloud = {
  /** Whether this device can read cloud history (signed in with Firebase). */
  available(): boolean {
    return auth.user()?.provider === "firebase";
  },

  async hosts(): Promise<TCloudHost[]> {
    const { db, root } = await clients();
    return (await db.list(`${root}/hosts`)).flatMap((d) => {
      const r = hostSchema.safeParse(d.data);
      return r.success ? [{ ...r.data, id: lastSegment(d.path) }] : [];
    });
  },

  async worktrees(): Promise<TCloudWorktree[]> {
    const { db, root } = await clients();
    return parsed(worktreeSchema, await db.list(`${root}/worktrees`));
  },

  async chats(): Promise<TCloudChat[]> {
    const { db, root } = await clients();
    return parsed(chatSchema, await db.list(`${root}/chats`));
  },

  /** A chat's items in order. */
  async items(chatId: string): Promise<TCloudItem[]> {
    const { db, root } = await clients();
    const docs = await db.query(`${root}/chats/${chatId}/items`, { orderBy: { field: "seq" } });
    return docs.flatMap((d) => {
      const item = chatItemSchema.safeParse(d.data);
      if (!item.success) return [];
      const seq = typeof d.data["seq"] === "number" ? d.data["seq"] : 0;
      const refs: unknown[] = [];
      const atts = d.data["attachments"];
      if (Array.isArray(atts)) refs.push(...atts);
      if (d.data["diff"] !== undefined) refs.push(d.data["diff"]);
      return [{ item: item.data, seq, files: refs.flatMap((r) => fileRefSchema.safeParse(r).data ?? []) }];
    });
  },

  /** A stored file as a `data:` URI (images in cloud history). */
  async fileUri(storagePath: string, mime: string): Promise<string> {
    const { files, root } = await clients();
    const bytes = await files.download(`${root}/${storagePath}`);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:${mime};base64,${globalThis.btoa(bin)}`;
  },
};
