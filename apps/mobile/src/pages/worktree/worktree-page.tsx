import { worktreeIdSchema } from "@agentdeck/protocol";
import { Link, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { LOCAL_HOST } from "@/lib/api";
import { ChatStatusBadge, useChatsQuery } from "@/modules/chats";
import { openInEditor, WorktreeTabs } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** A worktree's chats (spec: `wt/[worktreeId]/chats`), the first of its tabs. */
export function WorktreePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const chats = useChatsQuery(hostId, worktreeId);
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs
        hostId={hostId}
        worktreeId={worktreeId}
        active="chats"
        onOpenEditor={
          hostId === LOCAL_HOST
            ? (editor) => {
                void openInEditor(hostId, worktreeId, editor);
              }
            : undefined
        }
      />
      <ScrollView contentContainerClassName="gap-3 p-4" className="bg-background">
        <Text variant="h3">{t("chats.title")}</Text>
        {chats.isPending ? <Skeleton className="h-16 w-full" /> : null}
        {chats.data?.length === 0 ? <Text className="text-muted-foreground">{t("chats.empty")}</Text> : null}
        {chats.data?.map((c) => (
          <Link
            key={c.id}
            href={{ pathname: "/h/[hostId]/chat/[chatId]", params: { hostId, chatId: c.id } }}
            asChild
          >
            <Button variant="outline" className="h-auto justify-between py-3">
              <View className="flex-1">
                <Text className="font-medium">{c.title ?? t("chats.untitled", { agent: c.agent })}</Text>
              </View>
              <ChatStatusBadge status={c.status} />
            </Button>
          </Link>
        ))}
      </ScrollView>
    </View>
  );
}
