import { Link, Redirect, Stack } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { localHostDeviceId, useHostsStore } from "@/lib/api";
import {
  fromCloud,
  fromOverview,
  useCloudHistoryQuery,
  useOverviewQueries,
  WorkList,
  type TWorkHost,
} from "@/modules/workspace";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/**
 * Work: every computer's repos, branches and chats in one list. Online computers are live; for the
 * rest (offline, or no longer on the account) the list shows what they last wrote to the cloud. A
 * device with no account and no local daemon goes to sign-in.
 */
export function HomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const account = useHostsStore((s) => s.account);
  const localPending = useHostsStore((s) => s.localPending);
  const online = hosts.filter((h) => h.status === "online");
  const overviews = useOverviewQueries(online.map((h) => h.id));
  const history = useCloudHistoryQuery();
  if (account === "signedOut" && hosts.length === 0 && !localPending) return <Redirect href="/sign-in" />;
  const work: TWorkHost[] = hosts.map((h) => {
    const overview = overviews[online.findIndex((o) => o.id === h.id)]?.data;
    if (h.status === "online" && overview) return fromOverview(h, overview);
    if (history.data)
      return fromCloud({ ...h, online: h.status === "online" }, history.data.worktrees, history.data.chats);
    return {
      ...fromCloud({ ...h, online: false }, [], []),
      note: h.status === "online" ? t("work.loading") : t(`connection.${h.status}`),
    };
  });
  // Computers no longer on the account (or never online here) still have their history.
  const shownIds = new Set([...hosts.map((h) => h.id), localHostDeviceId()]);
  for (const ch of history.data?.hosts ?? []) {
    if (!shownIds.has(ch.id)) {
      work.push(
        fromCloud(
          { id: ch.id, name: ch.name, online: false },
          history.data?.worktrees ?? [],
          history.data?.chats ?? [],
        ),
      );
    }
  }
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
      {account === "signedIn" && work.length === 0 ? (
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
