import { repoIdSchema } from "@agentdeck/protocol";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { CompareList, useComparesQuery } from "@/modules/compare";
import { HostBadge } from "@/modules/hosts";
import { useReposQuery } from "@/modules/repos";
import { useWorktreesQuery, WorktreeList } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), repoId: repoIdSchema });

/** A repo's worktrees on one computer, and the "New task" button. */
export function RepoPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, repoId } = paramsSchema.parse(useLocalSearchParams());
  const repo = useReposQuery(hostId).data?.find((r) => r.id === repoId);
  const worktrees = useWorktreesQuery(hostId, repoId);
  const compares = useComparesQuery(hostId, repoId);
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      <View className="flex-row items-center justify-between">
        <Text variant="h3">{repo?.name ?? t("worktrees.title")}</Text>
        <Link href={{ pathname: "/new", params: { hostId, repoId } }} asChild>
          <Button>
            <Text>{t("newTask.cta")}</Text>
          </Button>
        </Link>
      </View>
      <HostBadge hostId={hostId} />
      {worktrees.isPending ? <Skeleton className="h-16 w-full" /> : null}
      {compares.data ? (
        <CompareList
          compares={compares.data}
          onOpen={(c) => {
            router.push({ pathname: "/h/[hostId]/compare/[compareId]", params: { hostId, compareId: c.id } });
          }}
        />
      ) : null}
      {worktrees.isSuccess ? <WorktreeList hostId={hostId} worktrees={worktrees.data} /> : null}
    </ScrollView>
  );
}
