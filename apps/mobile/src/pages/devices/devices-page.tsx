import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { thisDeviceId } from "@/lib/api";
import { DeviceList, useAccountDevicesQuery, useRemoveDeviceMutation } from "@/modules/devices";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

/** The phones and browsers signed in to the account; remove one (spec 2c: Devices). */
export function DevicesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const devices = useAccountDevicesQuery();
  const remove = useRemoveDeviceMutation();
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <Text variant="h3">{t("devices.title")}</Text>
      {devices.isPending ? <Skeleton className="h-16 w-full" /> : null}
      {devices.isSuccess ? (
        <DeviceList
          devices={devices.data.filter((d) => d.kind !== "daemon")}
          thisDeviceId={thisDeviceId()}
          onRemove={(id) => {
            remove.mutate(id);
          }}
        />
      ) : null}
      {remove.error ? <Text className="text-destructive">{remove.error.message}</Text> : null}
    </ScrollView>
  );
}
