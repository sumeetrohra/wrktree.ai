import type { TChat, TDiffFile } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";
import { cn } from "@/shared/utils/cn.utils";

/** Changed files shown per card; the Changes tab has them all. */
const MAX_FILES = 8;

export type TCompareCardProps = {
  who: string;
  chat: TChat | undefined;
  files: readonly TDiffFile[] | undefined;
  error: string | null;
  /** This entry was kept (`true`) or another was (`false`); `null` before a pick. */
  kept: boolean | null;
  onOpenChat: (() => void) | undefined;
  onChanges: () => void;
  onKeep: (() => void) | undefined;
};

/** One agent's attempt: who, its chat's state, what it changed, and the actions. */
export function CompareCard({
  who,
  chat,
  files,
  error,
  kept,
  onOpenChat,
  onChanges,
  onKeep,
}: TCompareCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const added = files?.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = files?.reduce((n, f) => n + f.removed, 0) ?? 0;
  return (
    <Card className={cn("w-80 max-w-full gap-3 p-4", kept === false && "opacity-60")}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="font-semibold">{who}</Text>
        {kept === true ? (
          <Badge>
            <Text>{t("compare.kept")}</Text>
          </Badge>
        ) : null}
        {chat ? (
          <Badge
            variant={chat.status === "crashed" || chat.status === "limited" ? "destructive" : "secondary"}
          >
            <Text>{t(`chat.status.${chat.status}`)}</Text>
          </Badge>
        ) : error === null ? (
          <Badge variant="outline">
            <Text>{t("compare.preparing")}</Text>
          </Badge>
        ) : null}
      </View>
      {error === null ? null : <Text className="text-destructive text-sm">{error}</Text>}
      {files === undefined ? null : files.length === 0 ? (
        <Text className="text-muted-foreground text-sm">{t("compare.noChanges")}</Text>
      ) : (
        <View className="gap-1">
          <Text className="text-sm">{t("compare.changed", { files: files.length, added, removed })}</Text>
          {files.slice(0, MAX_FILES).map((f) => (
            <Text key={f.path} className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {t("compare.fileLine", { path: f.path, added: f.added, removed: f.removed })}
            </Text>
          ))}
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {onOpenChat ? (
          <Button size="sm" variant="outline" onPress={onOpenChat}>
            <Text>{t("compare.openChat")}</Text>
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onPress={onChanges}>
          <Text>{t("compare.changes")}</Text>
        </Button>
        {onKeep ? (
          <Button size="sm" onPress={onKeep}>
            <Text>{t("compare.keep")}</Text>
          </Button>
        ) : null}
      </View>
    </Card>
  );
}
