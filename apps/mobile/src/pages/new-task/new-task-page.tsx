import { useMutation } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { useHostsStore } from "@/lib/api";
import { createChat, sendMessage } from "@/modules/chats";
import { CompareForm, startCompare, type TCompareForm } from "@/modules/compare";
import { useProfilesQuery } from "@/modules/profiles";
import { useReposQuery } from "@/modules/repos";
import { branchFor, createReadyWorktree, NewTaskForm, type TNewTask } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string().optional(), repoId: z.string().optional() });

/**
 * New task: pick a computer and a repo, then a worktree, a chat in it, and the first message. The
 * page composes the worktrees and chats modules; neither knows about the other.
 */
export function NewTaskPage(): React.JSX.Element {
  const { t } = useTranslation();
  const params = paramsSchema.parse(useLocalSearchParams());
  const allHosts = useHostsStore((s) => s.hosts);
  const hosts = allHosts.filter((h) => h.status === "online");
  const [pickedHost, setHostId] = useState<string | null>(params.hostId ?? null);
  const hostId = pickedHost ?? hosts[0]?.id ?? null;
  const [pickedRepo, setRepoId] = useState<string | null>(params.repoId ?? null);
  const repos = useReposQuery(hostId ?? "");
  const repoId = pickedRepo ?? repos.data?.[0]?.id ?? null;
  const profiles = useProfilesQuery(hostId);
  const [mode, setMode] = useState<"single" | "compare">("single");
  const compare = useMutation({
    mutationFn: async (v: TCompareForm) => {
      if (hostId === null || repoId === null) throw new Error("Pick a computer and a repository");
      const targets = v.profileIds.flatMap((id) => {
        const p = profiles.data?.find((x) => x.id === id);
        return p ? [{ profileId: p.id, agent: p.agent }] : [];
      });
      const c = await startCompare(hostId, {
        repoId,
        branch: branchFor(v.title),
        title: v.title,
        prompt: v.prompt,
        targets,
      });
      return { hostId, compareId: c.id };
    },
    onSuccess: (ids) => {
      router.replace({ pathname: "/h/[hostId]/compare/[compareId]", params: ids });
    },
  });
  const start = useMutation({
    mutationFn: async (v: TNewTask) => {
      const profile = profiles.data?.find((p) => p.id === v.profileId);
      if (hostId === null || repoId === null) throw new Error("Pick a computer and a repository");
      if (!profile) throw new Error("Pick a profile");
      const wt = await createReadyWorktree(hostId, { repoId, branch: branchFor(v.title), title: v.title });
      const chat = await createChat(hostId, {
        worktreeId: wt.id,
        agent: profile.agent,
        profileId: profile.id,
        title: v.title,
        ...(v.model === undefined || v.model === "" ? {} : { model: v.model }),
      });
      await sendMessage(hostId, chat.id, v.message);
      return { hostId, chatId: chat.id };
    },
    onSuccess: (ids) => {
      router.replace({ pathname: "/h/[hostId]/chat/[chatId]", params: ids });
    },
  });
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Text variant="h3">{t("newTask.heading")}</Text>
      <View className="gap-1.5">
        <Label nativeID="task-host">{t("newTask.host")}</Label>
        <View className="flex-row flex-wrap gap-2" aria-labelledby="task-host">
          {hosts.map((h) => (
            <Button
              key={h.id}
              size="sm"
              variant={h.id === hostId ? "default" : "outline"}
              onPress={() => {
                setHostId(h.id);
                setRepoId(null);
              }}
            >
              <Text>{h.name}</Text>
            </Button>
          ))}
        </View>
      </View>
      {hostId === null ? <Text className="text-muted-foreground">{t("newTask.noHosts")}</Text> : null}
      <View className="gap-1.5">
        <Label nativeID="task-repo">{t("newTask.repo")}</Label>
        <View className="flex-row flex-wrap gap-2" aria-labelledby="task-repo">
          {repos.data?.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={r.id === repoId ? "default" : "outline"}
              onPress={() => {
                setRepoId(r.id);
              }}
            >
              <Text>{r.name}</Text>
            </Button>
          ))}
        </View>
        {repos.data?.length === 0 ? <Text className="text-muted-foreground">{t("repos.empty")}</Text> : null}
      </View>
      {profiles.isPending && hostId !== null ? <Skeleton className="h-40 w-full" /> : null}
      {profiles.isSuccess ? (
        profiles.data.length === 0 ? (
          <Text className="text-muted-foreground">{t("newTask.noProfiles")}</Text>
        ) : (
          <View className="gap-4">
            <View className="flex-row gap-2">
              {(["single", "compare"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={m === mode ? "secondary" : "ghost"}
                  onPress={() => {
                    setMode(m);
                  }}
                >
                  <Text>{t(`newTask.mode.${m}`)}</Text>
                </Button>
              ))}
            </View>
            {mode === "single" ? (
              <NewTaskForm
                key={hostId}
                profiles={profiles.data}
                busy={start.isPending || repoId === null}
                onSubmit={(v) => {
                  start.mutate(v);
                }}
              />
            ) : (
              <CompareForm
                key={hostId}
                profiles={profiles.data}
                busy={compare.isPending || repoId === null}
                onSubmit={(v) => {
                  compare.mutate(v);
                }}
              />
            )}
          </View>
        )
      ) : null}
      {start.error ? (
        <Text className="text-destructive">{t("newTask.failed", { reason: start.error.message })}</Text>
      ) : null}
      {compare.error ? (
        <Text className="text-destructive">{t("newTask.failed", { reason: compare.error.message })}</Text>
      ) : null}
    </ScrollView>
  );
}
