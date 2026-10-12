import type { TJson } from "@agentdeck/firebase-rest";
import type { TChat, TChatItem, TWorktree } from "@agentdeck/protocol";

/**
 * How daemon state maps to Firestore documents under `users/{uid}/` (docs/phase-3.md, "Cloud
 * history"). Pure: the sync decides when to write.
 */

/** Plain JSON for Firestore: drops `undefined`, keeps everything else as is. */
function toJson(v: unknown): TJson {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === "object") {
    const out: Record<string, TJson> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = toJson(x);
    return out;
  }
  return null;
}

function toFields(v: unknown): Record<string, TJson> {
  const j = toJson(v);
  return j !== null && typeof j === "object" && !Array.isArray(j) ? j : {};
}

const worktreeKey = (hostId: string, worktreeId: string): string => `${hostId}__${worktreeId}`;
export const paths = {
  host: (hostId: string): string => `hosts/${hostId}`,
  worktree: (hostId: string, worktreeId: string): string => `worktrees/${worktreeKey(hostId, worktreeId)}`,
  chat: (chatId: string): string => `chats/${chatId}`,
  item: (chatId: string, itemId: string): string => `chats/${chatId}/items/${itemId}`,
  blob: (blobId: string): string => `blobs/${blobId}`,
};

export function worktreeDoc(hostId: string, wt: TWorktree, repoName: string): Record<string, TJson> {
  return toFields({
    hostId,
    worktreeId: wt.id,
    repoId: wt.repoId,
    repoName,
    title: wt.title,
    branch: wt.branch,
    baseRef: wt.baseRef,
    status: wt.status,
    createdAt: wt.createdAt,
    archivedAt: wt.archivedAt,
    updatedAt: Date.now(),
    deletedAt: null,
  });
}

export function chatDoc(hostId: string, chat: TChat, profileName: string | null): Record<string, TJson> {
  return toFields({
    hostId,
    chatId: chat.id,
    worktreeId: chat.worktreeId,
    worktreeKey: worktreeKey(hostId, chat.worktreeId),
    agent: chat.agent,
    profileId: chat.profileId,
    profileName,
    model: chat.model ?? null,
    title: chat.title,
    status: chat.status,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  });
}

/** A Firestore document holds at most 1 MiB; longer text is cut with a marker. */
const MAX_TEXT = 200_000;

function trimText(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n… (truncated in cloud history)`;
}

/** Blob ids an item refers to (attachments, a tool's diff); each is uploaded to Storage. */
export function blobsOf(item: TChatItem): string[] {
  if (item.kind === "user") return item.attachments.map((a) => a.blobId);
  if (item.kind === "tool" && item.diff) return [item.diff.blobId];
  return [];
}

/** The item as stored: its fields, `seq` (order in the chat), and Storage paths for its blobs. */
export function itemDoc(item: TChatItem, seq: number): Record<string, TJson> {
  const withPaths = (ref: { blobId: string; mime: string; size: number }) => ({
    ...ref,
    storagePath: paths.blob(ref.blobId),
  });
  const base = { ...item, seq };
  if (item.kind === "user") {
    return toFields({ ...base, text: trimText(item.text), attachments: item.attachments.map(withPaths) });
  }
  if (item.kind === "tool")
    return toFields({ ...base, ...(item.diff ? { diff: withPaths(item.diff) } : {}) });
  if (item.kind === "plan") return toFields(base);
  return toFields({ ...base, text: trimText(item.text) });
}

/** A streaming patch as a field merge. */
export function patchFields(patch: Record<string, unknown>): Record<string, TJson> {
  const fields = toFields(patch);
  const text = fields["text"];
  if (typeof text === "string") fields["text"] = trimText(text);
  return fields;
}
