import { repoIdSchema } from "@agentdeck/protocol";
import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";
import { z } from "zod";

import { createChat, sendMessage } from "@/modules/chats";
import { useProfilesQuery } from "@/modules/profiles";
import { branchFor, createReadyWorktree, NewTaskForm, type TNewTask } from "@/modules/worktrees";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ repoId: repoIdSchema });

/**
 * New task: a worktree, a chat in it, and the first message (spec: `repo/[repoId]/new`). The page
 * composes the worktrees and chats modules; neither knows about the other.
 */
export function NewTaskPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { repoId } = paramsSchema.parse(useLocalSearchParams());
  const profiles = useProfilesQuery();
  const start = useMutation({
    mutationFn: async (v: TNewTask) => {
      const profile = profiles.data?.find((p) => p.id === v.profileId);
      if (!profile) throw new Error("Pick a profile");
      const wt = await createReadyWorktree({ repoId, branch: branchFor(v.title), title: v.title });
      const chat = await createChat({
        worktreeId: wt.id,
        agent: profile.agent,
        profileId: profile.id,
        title: v.title,
      });
      await sendMessage(chat.id, v.message);
      return { worktreeId: wt.id, chatId: chat.id };
    },
    onSuccess: (ids) => {
      router.replace({ pathname: "/wt/[worktreeId]/chat/[chatId]", params: ids });
    },
  });
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Text variant="h3">{t("newTask.heading")}</Text>
      {profiles.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {profiles.isSuccess ? (
        profiles.data.length === 0 ? (
          <Text className="text-muted-foreground">{t("newTask.noProfiles")}</Text>
        ) : (
          <NewTaskForm
            profiles={profiles.data}
            busy={start.isPending}
            onSubmit={(v) => {
              start.mutate(v);
            }}
          />
        )
      ) : null}
      {start.error ? (
        <Text className="text-destructive">{t("newTask.failed", { reason: start.error.message })}</Text>
      ) : null}
    </ScrollView>
  );
}
