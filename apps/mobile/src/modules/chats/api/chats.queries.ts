import { codeContextSchema, type TBlobRef, type TChat, type TCodeContext } from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { z } from "zod";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { rememberHost } from "../stores/chat.store";

import { chatsKeys } from "./chats.keys";

export function useChatsQuery(hostId: string, worktreeId: string): UseQueryResult<TChat[]> {
  return useQuery({
    queryKey: chatsKeys.list(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "chat.list", { worktreeId }),
  });
}

/** `context`: worktree lines the message is about ("ask the agent about this"), quoted by the host. */
export function sendMessage(
  hostId: string,
  chatId: string,
  text: string,
  attachments: TBlobRef[] = [],
  context: TCodeContext[] = [],
): Promise<{ turnId: string; queued: boolean }> {
  return daemonCall(hostId, "chat.send", {
    chatId,
    text,
    ...(attachments.length ? { attachments } : {}),
    ...(context.length ? { context } : {}),
  });
}

/** Opens the chat with these lines attached to the next message. */
export function askAboutLines(hostId: string, chatId: string, context: TCodeContext): void {
  router.push({
    pathname: "/h/[hostId]/chat/[chatId]",
    params: { hostId, chatId, context: JSON.stringify([context]) },
  });
}

/** The `context` route param back as quoted lines (bad or missing → none). */
export function contextParam(raw: unknown): TCodeContext[] {
  if (typeof raw !== "string") return [];
  return tryParseJson(z.array(codeContextSchema).max(20), raw) ?? [];
}

export async function createChat(
  hostId: string,
  v: { worktreeId: string; profileId: string; agent: string; title?: string; model?: string },
): Promise<TChat> {
  const chat = await daemonCall(hostId, "chat.create", v);
  rememberHost(chat.id, hostId);
  return chat;
}

/** Continues the chat on another profile (Phase 4b); the new chat starts with a hand-off brief. */
export async function handoffChat(hostId: string, chatId: string, profileId: string): Promise<TChat> {
  const chat = await daemonCall(hostId, "chat.handoff", { chatId, profileId });
  rememberHost(chat.id, hostId);
  await queryClient.invalidateQueries({ queryKey: chatsKeys.list(hostId, chat.worktreeId) });
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
