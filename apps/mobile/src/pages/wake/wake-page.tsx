import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useHostsStore } from "@/lib/api";
import { chatNeedingAttention } from "@/modules/chats";
import { Text } from "@/shared/components/ui/text";

/**
 * Where a push notification lands (it carries no content): once every computer has caught up (or
 * is known to be away), open the chat with the newest pending permission, else the home screen.
 */
export function WakePage(): React.JSX.Element {
  const { t } = useTranslation();
  const settling = useHostsStore(
    (s) => s.localPending || s.hosts.length === 0 || s.hosts.some((h) => h.status === "connecting"),
  );
  if (settling) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <Text className="text-muted-foreground">{t("wake.catchingUp")}</Text>
      </View>
    );
  }
  const target = chatNeedingAttention();
  return target === null ? (
    <Redirect href="/" />
  ) : (
    <Redirect href={{ pathname: "/h/[hostId]/chat/[chatId]", params: target }} />
  );
}
