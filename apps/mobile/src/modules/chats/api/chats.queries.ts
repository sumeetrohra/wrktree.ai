import type { TBlobRef, TChat } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { rememberHost } from "../stores/chat.store";

import { chatsKeys } from "./chats.keys";

export function useChatsQuery(hostId: string, worktreeId: string): UseQueryResult<TChat[]> {
  return useQuery({
    queryKey: chatsKeys.list(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "chat.list", { worktreeId }),
  });
}

export function sendMessage(
  hostId: string,
  chatId: string,
  text: string,
  attachments: TBlobRef[] = [],
): Promise<{ turnId: string; queued: boolean }> {
  return daemonCall(hostId, "chat.send", { chatId, text, ...(attachments.length ? { attachments } : {}) });
}

export async function createChat(
  hostId: string,
  v: { worktreeId: string; profileId: string; agent: string; title?: string; model?: string },
): Promise<TChat> {
  const chat = await daemonCall(hostId, "chat.create", v);
  rememberHost(chat.id, hostId);
  return chat;
}

/** A chat's status in the list follows `chat.status` events, without refetching. Call once at startup. */
export function startChatListSync(): void {
  onDaemonEvent((_hostId, { event: e }) => {
    if (e.type !== "chat.status") return;
    for (const [key, data] of queryClient.getQueriesData<TChat[]>({ queryKey: chatsKeys.all })) {
      if (data?.some((c) => c.id === e.chatId)) {
        queryClient.setQueryData<TChat[]>(
          key,
          data.map((c) => (c.id === e.chatId ? { ...c, status: e.status } : c)),
        );
      }
    }
  });
}
