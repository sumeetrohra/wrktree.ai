import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

import { useProfilesQuery } from "../api/profiles.queries";

import { ProfileUsageRow } from "./profile-usage-row";

/** Every profile on one computer, with its limit state and today's tokens. */
export function ProfileUsageList({ hostId }: { hostId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const profiles = useProfilesQuery(hostId);
  if (profiles.isPending) return <Skeleton className="h-10" />;
  const list = profiles.data ?? [];
  if (list.length === 0) {
    return <Text className="text-muted-foreground text-sm">{t("settings.usage.noProfiles")}</Text>;
  }
  return (
    <View>
      {list.map((p) => (
        <ProfileUsageRow key={p.id} hostId={hostId} profile={p} />
      ))}
    </View>
  );
}
