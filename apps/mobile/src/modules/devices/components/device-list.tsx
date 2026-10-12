import type { TRelayDevice } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";
import { fromNow } from "@/shared/utils/datetime-utils";

export type TDeviceListProps = {
  devices: readonly TRelayDevice[];
  thisDeviceId: string | null;
  onRemove: (id: string) => void;
};

/** Devices on the account, with who is online and a Remove button (not for this device). */
export function DeviceList({ devices, thisDeviceId, onRemove }: TDeviceListProps): React.JSX.Element {
  const { t } = useTranslation();
  if (devices.length === 0) return <Text className="text-muted-foreground">{t("devices.empty")}</Text>;
  return (
    <View className="gap-3">
      {devices.map((d) => (
        <Card key={d.id}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <View className="flex-1 gap-1">
              <CardTitle>
                {d.id === thisDeviceId ? t("devices.thisDevice", { name: d.name }) : d.name}
              </CardTitle>
              <CardDescription>{t("devices.joined", { when: fromNow(d.createdAt) })}</CardDescription>
            </View>
            <Badge variant={d.connected ? "secondary" : "outline"}>
              <Text>{d.connected ? t("connection.online") : t("connection.offline")}</Text>
            </Badge>
            {d.id === thisDeviceId ? null : (
              <Button
                variant="destructive"
                size="sm"
                onPress={() => {
                  onRemove(d.id);
                }}
              >
                <Text>{t("devices.remove")}</Text>
              </Button>
            )}
          </CardHeader>
        </Card>
      ))}
    </View>
  );
}
