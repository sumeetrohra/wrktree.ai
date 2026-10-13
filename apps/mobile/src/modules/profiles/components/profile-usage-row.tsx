import type { TProfile } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";
import { fromNow } from "@/shared/utils/datetime-utils";

import { useProfileUsageQuery } from "../api/usage.queries";

/** One profile: its limit state and today's tokens. */
export function ProfileUsageRow({
  hostId,
  profile,
}: {
  hostId: string;
  profile: TProfile;
}): React.JSX.Element {
  const { t } = useTranslation();
  const usage = useProfileUsageQuery(hostId, profile.id).data;
  const state = !usage
    ? null
    : usage.limitHit
      ? usage.resetAt === undefined
        ? t("settings.usage.limitedUnknown")
        : t("settings.usage.limited", { when: fromNow(usage.resetAt) })
      : t("settings.usage.ok");
  return (
    <View className="border-border gap-0.5 border-b py-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-medium">
          {t("settings.usage.profile", { name: profile.name, agent: profile.agent })}
        </Text>
        <Text className={usage?.limitHit ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
          {state}
        </Text>
      </View>
      <Text className="text-muted-foreground text-xs">
        {usage?.inputTokens === undefined
          ? t("settings.usage.noTokens")
          : t("settings.usage.tokens", {
              input: usage.inputTokens.toLocaleString(),
              output: (usage.outputTokens ?? 0).toLocaleString(),
            })}
      </Text>
    </View>
  );
}
