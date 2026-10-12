import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useConnectionStore } from "@/lib/api";
import { ShortCodeView, usePairingStore } from "@/modules/pairing";
import { Text } from "@/shared/components/ui/text";

/** Step 3: compare the codes; the phone connects as soon as the computer confirms. */
export function ConfirmCodePage(): React.JSX.Element {
  const { t } = useTranslation();
  const code = usePairingStore((s) => s.code);
  const status = useConnectionStore((s) => s.status);
  if (code === null) return <Redirect href="/pair" />;
  if (status === "online") return <Redirect href="/" />;
  return (
    <View className="bg-background flex-1 items-center justify-center gap-6 p-6">
      <Stack.Screen options={{ headerShown: false }} />
      <ShortCodeView code={code} />
      <Text className="text-muted-foreground text-center">{t("pairing.confirmOnComputer")}</Text>
    </View>
  );
}
