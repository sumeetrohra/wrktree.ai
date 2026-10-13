import type { TCodeContext } from "@agentdeck/protocol";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";

export type TUserMessageProps = {
  text: string;
  attachments: number;
  images?: ReactNode;
  /** File lines the message quoted. */
  context?: readonly TCodeContext[];
};

const where = (c: TCodeContext): string =>
  c.endLine && c.endLine > c.line
    ? `${c.path}:${String(c.line)}–${String(c.endLine)}`
    : `${c.path}:${String(c.line)}`;

/** What the user sent, right-aligned, with its images when they can be shown. */
export function UserMessage({
  text,
  attachments,
  images,
  context = [],
}: TUserMessageProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="bg-primary ml-12 gap-2 self-end rounded-2xl px-4 py-2">
      {images ?? null}
      {context.map((c) => (
        <Text key={where(c)} className="text-primary-foreground/80 font-mono text-xs">
          {t("chat.quoted", { where: where(c) })}
        </Text>
      ))}
      <Text className="text-primary-foreground">{text}</Text>
      {attachments > 0 && images === undefined ? (
        <Text className="text-primary-foreground/80 text-xs">
          {t("chat.attachments", { count: attachments })}
        </Text>
      ) : null}
    </View>
  );
}
