import { Link, Redirect, Stack } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { unpair, useConnectionStore } from "@/lib/api";
import { ConnectionBadge } from "@/modules/machines";
import { RepoList, useReposQuery } from "@/modules/repos";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

/** Machines and repos (spec: `(main)/index`). Sends an unpaired phone to onboarding. */
export function HomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  const repos = useReposQuery();
  if (status === "unpaired") return <Redirect href="/pair" />;
  if (status === "revoked") {
    return (
      <View className="bg-background flex-1 gap-4 p-4">
        <Alert icon={CircleAlert} variant="destructive">
          <AlertTitle>{t("connection.revokedTitle")}</AlertTitle>
          <AlertDescription>{t("connection.revokedBody")}</AlertDescription>
        </Alert>
        <Button onPress={unpair}>
          <Text>{t("settings.unpair")}</Text>
        </Button>
      </View>
    );
  }
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center justify-between">
        <Text variant="h3">{t("repos.title")}</Text>
        <ConnectionBadge />
      </View>
      {repos.isPending ? <Skeleton className="h-20 w-full" /> : null}
      {repos.isError ? (
        <Alert icon={CircleAlert} variant="destructive">
          <AlertTitle>{t("repos.loadFailed")}</AlertTitle>
          <AlertDescription>{repos.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {repos.isSuccess ? <RepoList repos={repos.data} /> : null}
      <View className="flex-row gap-2">
        <Link href="/devices" asChild>
          <Button variant="outline">
            <Text>{t("devices.title")}</Text>
          </Button>
        </Link>
        <Link href="/settings" asChild>
          <Button variant="outline">
            <Text>{t("settings.title")}</Text>
          </Button>
        </Link>
      </View>
    </ScrollView>
  );
}
