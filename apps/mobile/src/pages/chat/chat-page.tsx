import { chatIdSchema } from "@agentdeck/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { z } from "zod";

import { uploadBlob, useHostsStore } from "@/lib/api";
import {
  ChatList,
  ChatStatusBadge,
  contextParam,
  HandoffSheet,
  handoffChat,
  LimitBanner,
  QuotedLines,
  sendMessage,
  useChatView,
  useCloudItemsQuery,
} from "@/modules/chats";
import { Composer } from "@/modules/composer";
import { HostBadge } from "@/modules/hosts";
import { PermissionSheet, useRespondPermissionMutation } from "@/modules/permissions";
import { useProfilesQuery } from "@/modules/profiles";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), chatId: chatIdSchema });

/**
 * One chat: the stream, the pending permission pinned above the composer (spec: chat screen).
 * While its computer is offline (or the chat's worktree is gone), the history comes from the
 * cloud and the chat is read-only.
 */
export function ChatPage(): React.JSX.Element {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const { hostId, chatId } = paramsSchema.parse(params);
  // Lines picked in a code or diff view ("ask the agent about this"), sent with the next message.
  const context = contextParam(params["context"]);
  const clearContext = (): void => {
    router.setParams({ context: undefined });
  };
  const view = useChatView(chatId);
  const respond = useRespondPermissionMutation(hostId);
  const online = useHostsStore((s) => s.hosts.find((h) => h.id === hostId)?.status === "online");
  const history = useCloudItemsQuery(chatId, !online);
  const live = view.order.flatMap((id) => (view.items[id] ? [view.items[id]] : []));
  const cloudItems = online ? [] : (history.data ?? []);
  const fromCloud = cloudItems.length > 0;
  const items = fromCloud ? cloudItems.map((h) => h.item) : live;
  const files = fromCloud ? new Map(cloudItems.map((h) => [h.item.id, h.files])) : undefined;
  const busy = view.status === "running" || view.status === "awaiting_permission";
  const [handoff, setHandoff] = useState<{ busy: boolean; error: string | null } | null>(null);
  const profiles = useProfilesQuery(handoff ? hostId : null);
  const continueOn = (profileId: string): void => {
    setHandoff({ busy: true, error: null });
    handoffChat(hostId, chatId, profileId)
      .then((chat) => {
        setHandoff(null);
        router.push({ pathname: "/h/[hostId]/chat/[chatId]", params: { hostId, chatId: chat.id } });
      })
      .catch((e: unknown) => {
        setHandoff({ busy: false, error: e instanceof Error ? e.message : String(e) });
      });
  };
  const openHandoff = (): void => {
    setHandoff({ busy: false, error: null });
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="bg-background flex-1"
    >
      <View className="border-border flex-row items-center justify-between border-b px-4 py-3">
        <ChatStatusBadge status={view.status} />
        {view.queued > 0 ? <Text variant="small">{t("chat.queued", { count: view.queued })}</Text> : null}
        {online && !handoff ? (
          <Button size="sm" variant="ghost" onPress={openHandoff}>
            <Text>{t("chat.handoff.open")}</Text>
          </Button>
        ) : null}
        <HostBadge hostId={hostId} />
      </View>
      {online && view.status === "limited" ? (
        <LimitBanner resetAt={view.resetAt}>
          {handoff ? null : (
            <Button size="sm" className="self-start" onPress={openHandoff}>
              <Text>{t("chat.handoff.fromLimit")}</Text>
            </Button>
          )}
        </LimitBanner>
      ) : null}
      {fromCloud ? (
        <Text className="text-muted-foreground px-4 py-2 text-xs">{t("chat.history")}</Text>
      ) : null}
      <View className="flex-1">
        <ChatList items={items} files={files} />
      </View>
      {online && handoff ? (
        <HandoffSheet
          profiles={profiles.data ?? []}
          busy={handoff.busy}
          error={handoff.error}
          onPick={continueOn}
          onClose={() => {
            setHandoff(null);
          }}
        />
      ) : null}
      {online && view.pending ? (
        <PermissionSheet
          request={view.pending}
          busy={respond.isPending}
          onRespond={(decision, message) => {
            if (!view.pending) return;
            respond.mutate({ chatId, requestId: view.pending.requestId, decision, message });
          }}
        />
      ) : null}
      {online && context.length > 0 ? <QuotedLines context={context} onClear={clearContext} /> : null}
      {online ? (
        <Composer
          agentBusy={busy}
          upload={(base64, mime) => uploadBlob(hostId, base64, mime)}
          onSend={(text, attachments) => {
            void sendMessage(hostId, chatId, text, attachments, context);
            if (context.length > 0) clearContext();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}
