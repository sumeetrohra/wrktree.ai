import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

import type { TWorkChat } from "../utils/work.utils";

/** Statuses that need the user. */
export const ATTENTION: readonly string[] = ["awaiting_permission", "limited", "crashed"];

/** One chat in the Work list: title, agent · profile · model, status. */
export function ChatRow({ hostId, chat }: { hostId: string; chat: TWorkChat }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Link href={{ pathname: "/h/[hostId]/chat/[chatId]", params: { hostId, chatId: chat.id } }} asChild>
      <Button variant="ghost" className="h-auto justify-between px-2 py-2">
        <View className="flex-1 gap-0.5">
          <Text className="font-medium">{chat.title ?? t("chats.untitled", { agent: chat.agent })}</Text>
          <Text className="text-muted-foreground text-xs">
            {[chat.agent, chat.profile, chat.model].filter((x) => x !== null).join(" · ")}
          </Text>
        </View>
        <Badge variant={ATTENTION.includes(chat.status) ? "destructive" : "outline"}>
          <Text>{t(`chat.status.${chat.status}`, { defaultValue: chat.status })}</Text>
        </Badge>
      </Button>
    </Link>
  );
}
