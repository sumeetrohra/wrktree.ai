import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { useHostsStore } from "@/lib/api";
import { useRemoveDeviceMutation } from "@/modules/devices";
import { HostList } from "@/modules/hosts";
import { Text } from "@/shared/components/ui/text";

/** The account's computers: which are online; remove one; link a new one. */
export function HostsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const account = useHostsStore((s) => s.account);
  const remove = useRemoveDeviceMutation();
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Text variant="h3">{t("hosts.title")}</Text>
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
