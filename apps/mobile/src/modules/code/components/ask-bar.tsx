import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

import type { TLineRange } from "../utils/selection.utils";

export type TAskBarProps = {
  path: string;
  selection: TLineRange;
  /** False when there is no chat in this worktree to ask. */
  canAsk: boolean;
  onAsk: () => void;
  onClear: () => void;
};

/** Pinned under a code or diff view while lines are selected: "Ask the agent about this". */
export function AskBar({ path, selection, canAsk, onAsk, onClear }: TAskBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const range =
    selection.endLine > selection.line
      ? t("code.lines", { from: selection.line, to: selection.endLine })
      : t("code.line", { line: selection.line });
  return (
    <View className="border-border bg-card flex-row items-center gap-2 border-t p-3">
      <Text className="flex-1 font-mono text-xs" numberOfLines={1}>
        {t("code.where", { path, range })}
      </Text>
      <Button variant="ghost" size="sm" onPress={onClear}>
        <Text>{t("code.clear")}</Text>
      </Button>
      <Button size="sm" disabled={!canAsk} onPress={onAsk}>
        <Text>{t("code.ask")}</Text>
      </Button>
    </View>
  );
}
