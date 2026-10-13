import type { TCompare } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TCompareListProps = { compares: readonly TCompare[]; onOpen: (compare: TCompare) => void };

/** A repo's compares: title and how many agents, each opening the side-by-side view. */
export function CompareList({ compares, onOpen }: TCompareListProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (compares.length === 0) return null;
  return (
    <View className="gap-2">
      <Text variant="h4">{t("compare.heading")}</Text>
      {compares.map((c) => (
        <Button
          key={c.id}
          variant="outline"
          className="justify-start"
          onPress={() => {
            onOpen(c);
          }}
        >
          <Text>
            {t(c.winner === null ? "compare.listItem" : "compare.listItemKept", {
              title: c.title,
              n: c.entries.length,
            })}
          </Text>
        </Button>
      ))}
    </View>
  );
}
