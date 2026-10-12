import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useConnectionStore } from "@/lib/api";
import { chatNeedingAttention } from "@/modules/chats";
import { Text } from "@/shared/components/ui/text";

/**
 * Where a push notification lands (it carries no content): once the phone has caught up, open the
 * chat with the newest pending permission, else the home screen.
 */
export function WakePage(): React.JSX.Element {
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  if (status !== "online") {
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
    <Redirect href={{ pathname: "/chat/[chatId]", params: { chatId: target } }} />
  );
}
