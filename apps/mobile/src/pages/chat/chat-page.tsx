import { chatIdSchema, worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { z } from "zod";

import { uploadBlob } from "@/lib/api";
import { ChatList, ChatStatusBadge, sendMessage, useChatView } from "@/modules/chats";
import { Composer } from "@/modules/composer";
import { ConnectionBadge } from "@/modules/machines";
import { PermissionSheet, useRespondPermissionMutation } from "@/modules/permissions";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ worktreeId: worktreeIdSchema.optional(), chatId: chatIdSchema });

/** One chat: the stream, the pending permission pinned above the composer (spec: chat screen). */
export function ChatPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { chatId } = paramsSchema.parse(useLocalSearchParams());
  const view = useChatView(chatId);
  const respond = useRespondPermissionMutation();
  const items = view.order.flatMap((id) => (view.items[id] ? [view.items[id]] : []));
  const busy = view.status === "running" || view.status === "awaiting_permission";
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="bg-background flex-1"
    >
      <View className="border-border flex-row items-center justify-between border-b px-4 py-3">
        <ChatStatusBadge status={view.status} />
        {view.queued > 0 ? <Text variant="small">{t("chat.queued", { count: view.queued })}</Text> : null}
        <ConnectionBadge />
      </View>
      <View className="flex-1">
        <ChatList items={items} />
      </View>
      {view.pending ? (
        <PermissionSheet
          request={view.pending}
          busy={respond.isPending}
          onRespond={(decision, message) => {
            if (!view.pending) return;
            respond.mutate({ chatId, requestId: view.pending.requestId, decision, message });
          }}
        />
      ) : null}
      <Composer
        agentBusy={busy}
        upload={uploadBlob}
        onSend={(text, attachments) => {
          void sendMessage(chatId, text, attachments);
        }}
      />
    </KeyboardAvoidingView>
  );
}
