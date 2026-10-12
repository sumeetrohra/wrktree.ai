import { Link, Redirect, Stack } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { useHostsStore } from "@/lib/api";
import { useOverviewQueries, WorkList } from "@/modules/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/**
 * Work: every computer's repos, branches and chats in one list (spec 2c: the new home). A device
 * with no account and no local daemon goes to sign-in.
 */
export function HomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const account = useHostsStore((s) => s.account);
  const localPending = useHostsStore((s) => s.localPending);
  const overviews = useOverviewQueries(hosts.filter((h) => h.status === "online").map((h) => h.id));
  if (account === "signedOut" && hosts.length === 0 && !localPending) return <Redirect href="/sign-in" />;
  const online = hosts.filter((h) => h.status === "online");
  const work = hosts.map((h) => {
    const q = overviews[online.findIndex((o) => o.id === h.id)];
    return {
      id: h.id,
      name: h.name,
      online: h.status === "online",
      overview: q?.data ?? null,
      error: q?.error ? q.error.message : h.status === "online" ? null : t(`connection.${h.status}`),
    };
  });
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-row items-center justify-between">
        <Text variant="h3">{t("work.title")}</Text>
        <Link href="/new" asChild>
          <Button disabled={online.length === 0}>
            <Text>{t("newTask.cta")}</Text>
          </Button>
        </Link>
      </View>
      {account === "removed" ? (
        <Alert icon={CircleAlert} variant="destructive">
          <AlertTitle>{t("connection.removedTitle")}</AlertTitle>
          <AlertDescription>{t("connection.removedBody")}</AlertDescription>
        </Alert>
      ) : null}
      {account !== "signedIn" ? (
        <Link href="/sign-in" asChild>
          <Button variant="outline">
            <Text>{hosts.some((h) => h.local) ? t("work.signInForMore") : t("auth.title")}</Text>
          </Button>
        </Link>
      ) : null}
      {account === "signedIn" && hosts.length === 0 ? (
        <Text className="text-muted-foreground">{t("work.noHosts")}</Text>
      ) : null}
      <WorkList hosts={work} />
      <View className="flex-row flex-wrap gap-2">
        <Link href="/hosts" asChild>
          <Button variant="outline">
            <Text>{t("hosts.title")}</Text>
          </Button>
        </Link>
        {account === "signedIn" ? (
          <Link href="/devices" asChild>
            <Button variant="outline">
              <Text>{t("devices.title")}</Text>
            </Button>
          </Link>
        ) : null}
        <Link href="/settings" asChild>
          <Button variant="outline">
            <Text>{t("settings.title")}</Text>
          </Button>
        </Link>
      </View>
    </ScrollView>
  );
}
