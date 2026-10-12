import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { useHostsStore } from "@/lib/api";
import { auth } from "@/lib/auth";
import { useSignOutMutation } from "@/modules/auth";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** The account this device is signed in to, and signing out. */
export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const account = useHostsStore((s) => s.account);
  const signOut = useSignOutMutation();
  const user = auth.user();
  return (
    <View className="bg-background flex-1 gap-4 p-4">
      <Text variant="h3">{t("settings.title")}</Text>
      <Text>
        {account === "signedIn"
          ? t("settings.signedInAs", { email: user?.email ?? user?.uid ?? "" })
          : t("settings.signedOut")}
      </Text>
      {account === "signedIn" ? (
        <Button
          variant="destructive"
          disabled={signOut.isPending}
          onPress={() => {
            signOut.mutate(undefined, {
              onSuccess: () => {
                router.replace("/");
              },
            });
          }}
        >
          <Text>{t("settings.signOut")}</Text>
        </Button>
      ) : null}
    </View>
  );
}
