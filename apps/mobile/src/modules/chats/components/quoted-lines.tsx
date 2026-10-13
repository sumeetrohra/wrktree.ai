import type { TCodeContext } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TQuotedLinesProps = { context: readonly TCodeContext[]; onClear: () => void };

/** Above the composer: the lines the next message will quote. */
export function QuotedLines({ context, onClear }: TQuotedLinesProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="border-border bg-muted flex-row items-center gap-2 border-t px-4 py-2">
      <View className="flex-1">
        {context.map((c) => (
          <Text key={`${c.path}:${String(c.line)}`} className="font-mono text-xs" numberOfLines={1}>
            {t("chat.quoting", {
              where:
                c.endLine && c.endLine > c.line
                  ? `${c.path}:${String(c.line)}–${String(c.endLine)}`
                  : `${c.path}:${String(c.line)}`,
            })}
          </Text>
        ))}
      </View>
      <Button size="sm" variant="ghost" onPress={onClear}>
        <Text>{t("code.clear")}</Text>
      </Button>
    </View>
  );
}
