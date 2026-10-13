import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { ChangedFileRow, useDiffSummaryQuery, type TAgainst } from "@/modules/changes";
import { WorktreeTabs } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** What the agent changed: against the base branch, or only what isn't committed yet. */
export function WorktreeChangesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const [against, setAgainst] = useState<TAgainst>("base");
  const diff = useDiffSummaryQuery(hostId, worktreeId, against);
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="changes" />
      <View className="flex-row gap-1 px-3 py-2">
        {(["base", "head"] as const).map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === against ? "secondary" : "ghost"}
            onPress={() => {
              setAgainst(a);
            }}
          >
            <Text>{t(`changes.against.${a}`, { base: diff.data?.against ?? "" })}</Text>
          </Button>
        ))}
      </View>
      <ScrollView contentContainerClassName="pb-6">
        {diff.isPending ? <Skeleton className="mx-3 h-10" /> : null}
        {diff.data?.files.length === 0 ? (
          <Text className="text-muted-foreground px-4">{t("changes.none")}</Text>
        ) : null}
        {diff.data?.files.map((f) => (
          <ChangedFileRow key={f.path} hostId={hostId} worktreeId={worktreeId} file={f} against={against} />
        ))}
      </ScrollView>
    </View>
  );
}
