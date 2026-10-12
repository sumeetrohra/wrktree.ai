import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";

export type TShortCodeViewProps = { code: string };

/** The six digits both screens show; the user checks they match. */
export function ShortCodeView({ code }: TShortCodeViewProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="items-center gap-2">
      <Text className="text-muted-foreground">{t("pairing.compare")}</Text>
      <Text variant="h1" accessibilityLabel={t("pairing.codeLabel", { code })} testID="short-code">
        {t("pairing.code", { first: code.slice(0, 3), second: code.slice(3) })}
      </Text>
    </View>
  );
}
