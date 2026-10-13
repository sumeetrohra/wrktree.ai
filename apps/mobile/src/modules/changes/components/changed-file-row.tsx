import type { TDiffFile } from "@agentdeck/protocol";
import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TChangedFileRowProps = {
  hostId: string;
  worktreeId: string;
  file: TDiffFile;
  against: "base" | "head";
};

/** A changed file: path, +added −removed, status; opens its diff. */
export function ChangedFileRow({
  hostId,
  worktreeId,
  file,
  against,
}: TChangedFileRowProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Link
      href={{
        pathname: "/h/[hostId]/wt/[worktreeId]/diff/[...path]",
        params: { hostId, worktreeId, path: file.path.split("/"), against },
      }}
      asChild
    >
      <Button variant="ghost" className="h-auto justify-between px-3 py-2">
        <Text className="flex-1 font-mono text-xs" numberOfLines={1}>
          {file.path}
        </Text>
        <View className="flex-row items-center gap-2">
          <Text className="text-primary font-mono text-xs">{t("changes.added", { count: file.added })}</Text>
          <Text className="text-destructive font-mono text-xs">
            {t("changes.removed", { count: file.removed })}
          </Text>
          <Badge variant="outline">
            <Text>{t(`changes.status.${file.status}`)}</Text>
          </Badge>
        </View>
      </Button>
    </Link>
  );
}
