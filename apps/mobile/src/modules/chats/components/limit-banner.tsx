import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";
import { fromNow } from "@/shared/utils/datetime-utils";

export type TLimitBannerProps = {
  resetAt: number | null;
  /** Actions under the message (e.g. continue on another profile). */
  children?: React.ReactNode;
};

/** Shown while a chat's profile is at its usage limit. */
export function LimitBanner({ resetAt, children }: TLimitBannerProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="border-border bg-muted gap-1 border-b px-4 py-3" accessibilityRole="alert">
      <Text className="font-semibold">{t("chat.limit.title")}</Text>
      <Text className="text-muted-foreground text-sm">
        {resetAt === null ? t("chat.limit.unknown") : t("chat.limit.resets", { when: fromNow(resetAt) })}
      </Text>
      {children}
    </View>
  );
}
