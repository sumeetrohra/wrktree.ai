import type { TDevice } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";
import { fromNow } from "@/shared/utils/datetime-utils";

export type TDeviceListProps = {
  devices: readonly TDevice[];
  thisDeviceId: string | null;
  onRevoke: (id: string) => void;
};

export function DeviceList({ devices, thisDeviceId, onRevoke }: TDeviceListProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      {devices.map((d) => (
        <Card key={d.id}>
          <CardHeader className="flex-row items-center justify-between">
            <View className="flex-1 gap-1">
              <CardTitle>
                {d.id === thisDeviceId ? t("devices.thisDevice", { name: d.name }) : d.name}
              </CardTitle>
              <CardDescription>
                {d.revokedAt === null
                  ? t("devices.paired", { when: fromNow(d.pairedAt) })
                  : t("devices.revoked", { when: fromNow(d.revokedAt) })}
              </CardDescription>
            </View>
            {d.revokedAt === null ? (
              <Button
                variant="destructive"
                size="sm"
                onPress={() => {
                  onRevoke(d.id);
                }}
              >
                <Text>{t("devices.revoke")}</Text>
              </Button>
            ) : null}
          </CardHeader>
        </Card>
      ))}
    </View>
  );
}
