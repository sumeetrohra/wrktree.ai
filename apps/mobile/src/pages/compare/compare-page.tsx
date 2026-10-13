import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { CompareCard, pickCompare, useCompareEntries, useCompareQuery } from "@/modules/compare";
import { useProfilesQuery } from "@/modules/profiles";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), compareId: z.string() });

/** One task, several agents: their attempts side by side; keep one (Phase 5). */
export function ComparePage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, compareId } = paramsSchema.parse(useLocalSearchParams());
  const compare = useCompareQuery(hostId, compareId);
  const states = useCompareEntries(hostId, compare.data);
  const profiles = useProfilesQuery(hostId).data ?? [];
  const [error, setError] = useState<string | null>(null);
  const c = compare.data;
  return (
    <ScrollView contentContainerClassName="gap-4 p-4" className="bg-background">
      {c === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <View className="gap-1">
            <Text variant="h3">{c.title}</Text>
            <Text className="text-muted-foreground">{c.prompt}</Text>
            <Text className="text-muted-foreground text-sm">
              {t(c.winner === null ? "compare.pickHint" : "compare.pickedHint")}
            </Text>
          </View>
          <ScrollView horizontal contentContainerClassName="gap-3 pb-2">
            {c.entries.map((e, i) => {
              const profile = profiles.find((p) => p.id === e.profileId);
              const who = t(e.model ? "compare.whoModel" : "compare.who", {
                name: profile?.name ?? e.agent,
                agent: e.agent,
                model: e.model ?? "",
              });
              const chatId = e.chatId;
              return (
                <CompareCard
                  key={e.worktreeId}
                  who={who}
                  chat={states[i]?.chat}
                  files={states[i]?.files}
                  error={e.error}
                  kept={c.winner === null ? null : c.winner === e.worktreeId}
                  onOpenChat={
                    chatId === null
                      ? undefined
                      : () => {
                          router.push({ pathname: "/h/[hostId]/chat/[chatId]", params: { hostId, chatId } });
                        }
                  }
                  onChanges={() => {
                    router.push({
                      pathname: "/h/[hostId]/wt/[worktreeId]/changes",
                      params: { hostId, worktreeId: e.worktreeId },
                    });
                  }}
                  onKeep={
                    c.winner === null
                      ? () => {
                          setError(null);
                          pickCompare(hostId, c.id, e.worktreeId).catch((err: unknown) => {
                            setError(err instanceof Error ? err.message : String(err));
                          });
                        }
                      : undefined
                  }
                />
              );
            })}
          </ScrollView>
        </>
      )}
      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
    </ScrollView>
  );
}
