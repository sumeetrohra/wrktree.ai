import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { unpair, useConnectionStore } from "@/lib/api";
import { ConnectionBadge } from "@/modules/machines";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** The paired machine and unpairing (spec: `settings`). */
export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const local = useConnectionStore((s) => s.local);
  return (
    <View className="bg-background flex-1 gap-4 p-4">
      <Text variant="h3">{t("settings.title")}</Text>
      <ConnectionBadge />
      {local ? null : (
        <Button
          variant="destructive"
          onPress={() => {
            unpair();
            router.replace("/pair");
          }}
        >
          <Text>{t("settings.unpair")}</Text>
        </Button>
      )}
    </View>
  );
}
