import type { TChat, TChatStatus } from "@agentdeck/protocol";
import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** Statuses that need the user. */
export const ATTENTION: readonly TChatStatus[] = ["awaiting_permission", "limited", "crashed"];

/** One chat in the Work list: title, agent · profile · model, status. */
export function ChatRow({
  hostId,
  chat,
  profile,
}: {
  hostId: string;
  chat: TChat;
  profile: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Link href={{ pathname: "/h/[hostId]/chat/[chatId]", params: { hostId, chatId: chat.id } }} asChild>
      <Button variant="ghost" className="h-auto justify-between px-2 py-2">
        <View className="flex-1 gap-0.5">
          <Text className="font-medium">{chat.title ?? t("chats.untitled", { agent: chat.agent })}</Text>
          <Text className="text-muted-foreground text-xs">
            {[chat.agent, profile, chat.model].filter((x) => x !== null && x !== undefined).join(" · ")}
          </Text>
        </View>
        <Badge variant={ATTENTION.includes(chat.status) ? "destructive" : "outline"}>
          <Text>{t(`chat.status.${chat.status}`)}</Text>
        </Badge>
      </Button>
    </Link>
  );
}
