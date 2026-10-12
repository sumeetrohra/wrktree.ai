import { repoIdSchema } from "@agentdeck/protocol";
import { Link, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { useReposQuery } from "@/modules/repos";
import { useWorktreesQuery, WorktreeList } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ repoId: repoIdSchema });

/** A repo's worktrees and the "New task" button (spec: `repo/[repoId]/index`). */
export function RepoPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { repoId } = paramsSchema.parse(useLocalSearchParams());
  const repo = useReposQuery().data?.find((r) => r.id === repoId);
  const worktrees = useWorktreesQuery(repoId);
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <View className="flex-row items-center justify-between">
        <Text variant="h3">{repo?.name ?? t("worktrees.title")}</Text>
        <Link href={{ pathname: "/repo/[repoId]/new", params: { repoId } }} asChild>
          <Button>
            <Text>{t("newTask.cta")}</Text>
          </Button>
        </Link>
      </View>
      {worktrees.isPending ? <Skeleton className="h-16 w-full" /> : null}
      {worktrees.isSuccess ? <WorktreeList worktrees={worktrees.data} /> : null}
    </ScrollView>
  );
}
