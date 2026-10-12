import { worktreeIdSchema } from "@agentdeck/protocol";
import { Link, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { ChatStatusBadge, useChatsQuery } from "@/modules/chats";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** A worktree's chats (spec: `wt/[worktreeId]/chats`; the other tabs come in Phase 3). */
export function WorktreePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const chats = useChatsQuery(hostId, worktreeId);
  return (
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
  );
}
