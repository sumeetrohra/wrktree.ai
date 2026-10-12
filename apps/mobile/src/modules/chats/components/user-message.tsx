import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";

export type TUserMessageProps = { text: string; attachments: number };

/** What the user sent, right-aligned. */
export function UserMessage({ text, attachments }: TUserMessageProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="bg-primary ml-12 self-end rounded-2xl px-4 py-2">
      <Text className="text-primary-foreground">{text}</Text>
      {attachments > 0 ? (
        <Text className="text-primary-foreground/80 text-xs">
          {t("chat.attachments", { count: attachments })}
        </Text>
      ) : null}
    </View>
  );
}
