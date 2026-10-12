import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { thisDeviceId } from "@/lib/api";
import { DeviceList, useDevicesQuery, useRevokeDeviceMutation } from "@/modules/devices";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

/** Paired devices; revoke one (spec: `devices`). */
export function DevicesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const devices = useDevicesQuery();
  const revoke = useRevokeDeviceMutation();
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Text variant="h3">{t("devices.title")}</Text>
      {devices.isPending ? <Skeleton className="h-16 w-full" /> : null}
      {devices.isSuccess ? (
        <DeviceList
          devices={devices.data}
          thisDeviceId={thisDeviceId()}
          onRevoke={(id) => {
            revoke.mutate(id);
          }}
        />
      ) : null}
    </ScrollView>
  );
}
