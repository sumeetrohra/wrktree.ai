import {
  chatItemSchema,
  chatStatusSchema,
  permissionRequestSchema,
  type TChatItem,
  type TChatStatus,
  type TEvtFrame,
  type TPermissionRequest,
} from "@agentdeck/protocol";
import { z } from "zod";
import { create } from "zustand";

import { onDaemonEvent } from "@/lib/api";
import { attentionHaptic } from "@/lib/device";
import { storage } from "@/lib/storage";

import { applyPatch } from "../utils/apply-patch.utils";

/** How many items per chat survive a cold start (spec: last 200). */
const KEEP = 200;

export type TChatView = {
  items: Record<string, TChatItem>;
  order: string[];
  status: TChatStatus | null;
  pending: TPermissionRequest | null;
  queued: number;
};

const EMPTY: TChatView = { items: {}, order: [], status: null, pending: null, queued: 0 };

const persistedSchema = z.object({
  items: z.array(chatItemSchema),
  status: chatStatusSchema.nullable(),
  pending: permissionRequestSchema.nullable(),
  queued: z.number(),
});

type TChatsState = {
  chats: Record<string, TChatView>;
  /** Folds one daemon event into the affected chat. Pure apart from persistence and haptics. */
  apply: (e: TEvtFrame) => void;
};

const storageKey = (chatId: string): string => `chat.${chatId}`;
/** Ids of every chat with saved state, so a cold start can find one that needs the user. */
const INDEX_KEY = "chats.index";
const savedChatIds = (): string[] => storage.get(INDEX_KEY, z.array(z.string())) ?? [];

function hydrate(chatId: string): TChatView {
  const saved = storage.get(storageKey(chatId), persistedSchema);
  if (!saved) return EMPTY;
  const items = Object.fromEntries(saved.items.map((i) => [i.id, i]));
  return {
    items,
    order: saved.items.map((i) => i.id),
    status: saved.status,
    pending: saved.pending,
    queued: saved.queued,
  };
}

function persist(chatId: string, v: TChatView): void {
  const ids = savedChatIds();
  if (!ids.includes(chatId)) storage.set(INDEX_KEY, [...ids, chatId]);
  const recent = v.order.slice(-KEEP).flatMap((id) => (v.items[id] ? [v.items[id]] : []));
  storage.set(storageKey(chatId), { items: recent, status: v.status, pending: v.pending, queued: v.queued });
}

function reduce(v: TChatView, e: TEvtFrame["event"]): TChatView {
  switch (e.type) {
    case "chat.item":
      return v.items[e.item.id]
        ? { ...v, items: { ...v.items, [e.item.id]: e.item } }
        : { ...v, items: { ...v.items, [e.item.id]: e.item }, order: [...v.order, e.item.id] };
    case "chat.itemPatch": {
      const item = v.items[e.itemId];
      return item ? { ...v, items: { ...v.items, [e.itemId]: applyPatch(item, e.patch) } } : v;
    }
    case "chat.status":
      return { ...v, status: e.status, queued: e.queued ?? v.queued };
    case "permission.requested":
      return { ...v, pending: e.request };
    case "permission.resolved":
      return v.pending?.requestId === e.requestId ? { ...v, pending: null } : v;
    case "worktree.updated":
    case "worktree.removed":
    case "usage.updated":
    case "proc.output":
    case "preview.status":
    case "device.updated":
      return v;
  }
}

function chatIdOf(e: TEvtFrame["event"]): string | null {
  return "chatId" in e ? e.chatId : null;
}

/**
 * Every open chat's items, status and pending permission (spec: chat store), fed by daemon events
 * and backed by MMKV so a cold start shows the recent conversation at once.
 */
export const useChatsStore = create<TChatsState>()((set, get) => ({
  chats: {},
  apply: (frame) => {
    const chatId = chatIdOf(frame.event);
    if (chatId === null) return;
    const before = get().chats[chatId] ?? hydrate(chatId);
    const after = reduce(before, frame.event);
    if (after === before) return;
    if (frame.event.type === "permission.requested") attentionHaptic();
    persist(chatId, after);
    set({ chats: { ...get().chats, [chatId]: after } });
  },
}));

let started = false;

/** Feeds daemon events into the chat store. Call once at startup, before any event can arrive. */
export function startChatStoreSync(): void {
  if (started) return;
  started = true;
  onDaemonEvent((e) => {
    useChatsStore.getState().apply(e);
  });
}

/** One chat's view, hydrated from storage the first time it is read. */
export function chatView(chatId: string): TChatView {
  return useChatsStore.getState().chats[chatId] ?? hydrate(chatId);
}

export function useChatView(chatId: string): TChatView {
  return useChatsStore((s) => s.chats[chatId]) ?? chatView(chatId);
}

/** The newest chat waiting on a permission (where a push notification should land). */
export function chatNeedingAttention(): string | null {
  let best: { id: string; at: number } | null = null;
  const ids = new Set([...savedChatIds(), ...Object.keys(useChatsStore.getState().chats)]);
  for (const id of ids) {
    const v = chatView(id);
    if (v.pending && (!best || v.pending.at > best.at)) best = { id, at: v.pending.at };
  }
  return best?.id ?? null;
}
