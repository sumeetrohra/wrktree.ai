import type { TWorktree } from "@agentdeck/protocol";
import { Link } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TWorktreeListProps = { hostId: string; worktrees: readonly TWorktree[] };

export function WorktreeList({ hostId, worktrees }: TWorktreeListProps): React.JSX.Element {
  const { t } = useTranslation();
  const visible = worktrees.filter((w) => w.status !== "archived");
  if (visible.length === 0) return <Text className="text-muted-foreground">{t("worktrees.empty")}</Text>;
  return (
    <View className="gap-2">
      {visible.map((w) => (
        <Link
          key={w.id}
          href={{ pathname: "/h/[hostId]/wt/[worktreeId]", params: { hostId, worktreeId: w.id } }}
          asChild
        >
          <Button variant="outline" className="h-auto justify-between py-3">
            <View className="flex-1 gap-0.5">
              <Text className="font-medium">{w.title}</Text>
              <Text className="text-muted-foreground text-xs">{w.branch}</Text>
            </View>
            <Badge variant={w.status === "ready" ? "secondary" : "outline"}>
              <Text>{t(`worktrees.status.${w.status}`)}</Text>
            </Badge>
          </Button>
        </Link>
      ))}
    </View>
  );
}
