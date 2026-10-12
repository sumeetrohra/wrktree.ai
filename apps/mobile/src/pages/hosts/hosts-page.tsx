import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { useHostsStore } from "@/lib/api";
import { useRemoveDeviceMutation } from "@/modules/devices";
import { HostList } from "@/modules/hosts";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** The account's computers: which are online; remove one; link a new one. */
export function HostsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const account = useHostsStore((s) => s.account);
  const remove = useRemoveDeviceMutation();
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <View className="flex-row items-center justify-between">
        <Text variant="h3">{t("hosts.title")}</Text>
        {account === "signedIn" ? (
          <Link href="/link" asChild>
            <Button>
              <Text>{t("link.cta")}</Text>
            </Button>
          </Link>
        ) : null}
      </View>
      <Text className="text-muted-foreground">{t("hosts.intro")}</Text>
      <HostList
        hosts={hosts}
        onRemove={
          account === "signedIn"
            ? (id) => {
                remove.mutate(id);
              }
            : null
        }
      />
      {remove.error ? <Text className="text-destructive">{remove.error.message}</Text> : null}
    </ScrollView>
  );
}
