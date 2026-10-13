import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { useHostsStore } from "@/lib/api";
import { auth } from "@/lib/auth";
import { useSignOutMutation } from "@/modules/auth";
import { ProfileUsageList } from "@/modules/profiles";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** The account this device is signed in to, signing out, and each computer's profile usage. */
export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const account = useHostsStore((s) => s.account);
  const signOut = useSignOutMutation();
  const user = auth.user();
  const hosts = useHostsStore((s) => s.hosts).filter((h) => h.status === "online");
  return (
    <ScrollView className="bg-background flex-1" contentContainerClassName="gap-4 p-4">
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
      {hosts.length > 0 ? <Text variant="h4">{t("settings.usage.title")}</Text> : null}
      {hosts.map((h) => (
        <View key={h.id} className="gap-1">
          <Text className="text-muted-foreground text-sm">{h.name}</Text>
          <ProfileUsageList hostId={h.id} />
        </View>
      ))}
    </ScrollView>
  );
}
