import type { TBlobRef, TChat } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { chatsKeys } from "./chats.keys";

export function useChatsQuery(worktreeId: string): UseQueryResult<TChat[]> {
  return useQuery({
    queryKey: chatsKeys.list(worktreeId),
    queryFn: () => daemonCall("chat.list", { worktreeId }),
  });
}

export function sendMessage(
  chatId: string,
  text: string,
  attachments: TBlobRef[] = [],
): Promise<{ turnId: string; queued: boolean }> {
  return daemonCall("chat.send", { chatId, text, ...(attachments.length ? { attachments } : {}) });
}

export function createChat(v: {
  worktreeId: string;
  profileId: string;
  agent: string;
  title?: string;
}): Promise<TChat> {
  return daemonCall("chat.create", v);
}

/** A chat's status in the list follows `chat.status` events, without refetching. Call once at startup. */
export function startChatListSync(): void {
  onDaemonEvent(({ event: e }) => {
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
