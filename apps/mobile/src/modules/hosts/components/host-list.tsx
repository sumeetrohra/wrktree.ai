import { useTranslation } from "react-i18next";
import { View } from "react-native";

import type { THost } from "@/lib/api";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";

export type THostListProps = {
  hosts: readonly THost[];
  /** Null hides Remove (e.g. this computer's own daemon, or when signed out). */
  onRemove: ((id: string) => void) | null;
};

/** The account's computers, online or not. */
export function HostList({ hosts, onRemove }: THostListProps): React.JSX.Element {
  const { t } = useTranslation();
  if (hosts.length === 0) return <Text className="text-muted-foreground">{t("hosts.empty")}</Text>;
  return (
    <View className="gap-3">
      {hosts.map((h) => (
        <Card key={h.id}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <View className="flex-1 gap-1">
              <CardTitle>{h.name}</CardTitle>
              <CardDescription>{h.local ? t("hosts.local") : t("hosts.viaRelay")}</CardDescription>
            </View>
            <Badge variant={h.status === "online" ? "secondary" : "outline"}>
              <Text>{t(`connection.${h.status}`)}</Text>
            </Badge>
            {onRemove === null || h.local ? null : (
              <Button
                variant="destructive"
                size="sm"
                onPress={() => {
                  onRemove(h.id);
                }}
              >
                <Text>{t("hosts.remove")}</Text>
              </Button>
            )}
          </CardHeader>
        </Card>
      ))}
    </View>
  );
}
