import type { TChat } from "@agentdeck/protocol";
import { Link } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { Text } from "@/shared/components/ui/text";

import type { TOverview } from "../api/overview.queries";

import { ATTENTION, ChatRow } from "./chat-row";

export type TWorkHost = {
  id: string;
  name: string;
  online: boolean;
  overview: TOverview | null;
  error: string | null;
};

type TFilter = "all" | "attention" | "running";

function matches(filter: TFilter, c: TChat): boolean {
  if (filter === "attention") return ATTENTION.includes(c.status);
  if (filter === "running") return c.status === "running" || c.status === "awaiting_permission";
  return true;
}

/**
 * Everything every computer is working on: host → repo → branch → chats, with the agent, profile,
 * model and status of each chat. Filters by computer and by what needs you.
 */
export function WorkList({ hosts }: { hosts: readonly TWorkHost[] }): React.JSX.Element {
  const { t } = useTranslation();
  const [hostFilter, setHostFilter] = useState<string | null>(null);
  const [filter, setFilter] = useState<TFilter>("all");
  const shown = hosts.filter((h) => hostFilter === null || h.id === hostFilter);
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          variant={hostFilter === null ? "default" : "outline"}
          onPress={() => {
            setHostFilter(null);
          }}
        >
          <Text>{t("work.allHosts")}</Text>
        </Button>
        {hosts.map((h) => (
          <Button
            key={h.id}
            size="sm"
            variant={hostFilter === h.id ? "default" : "outline"}
            onPress={() => {
              setHostFilter(h.id);
            }}
          >
            <Text>{h.name}</Text>
          </Button>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {(["all", "attention", "running"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "secondary" : "ghost"}
            onPress={() => {
              setFilter(f);
            }}
          >
            <Text>{t(`work.filter.${f}`)}</Text>
          </Button>
        ))}
      </View>
      {shown.map((h) => (
        <Card key={h.id} className={h.online ? "" : "opacity-60"}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{h.name}</CardTitle>
            <Badge variant={h.online ? "secondary" : "outline"}>
              <Text>{h.online ? t("connection.online") : t("connection.offline")}</Text>
            </Badge>
          </CardHeader>
          <CardContent className="gap-3">
            {h.overview === null ? (
              <Text className="text-muted-foreground">{h.error ?? t("work.loading")}</Text>
            ) : h.overview.repos.length === 0 ? (
              <Text className="text-muted-foreground">{t("repos.empty")}</Text>
            ) : (
              h.overview.repos.map((repo) => {
                const overview = h.overview;
                const worktrees = (overview?.worktrees ?? []).filter(
                  (w) => w.repoId === repo.id && w.status !== "archived",
                );
                return (
                  <View key={repo.id} className="gap-1">
                    <Link
                      href={{
                        pathname: "/h/[hostId]/repo/[repoId]",
                        params: { hostId: h.id, repoId: repo.id },
                      }}
                      asChild
                    >
                      <Button variant="link" className="h-auto justify-start p-0">
                        <Text className="font-semibold">{repo.name}</Text>
                      </Button>
                    </Link>
                    {worktrees.length === 0 ? (
                      <Text className="text-muted-foreground text-xs">{t("worktrees.empty")}</Text>
                    ) : null}
                    {worktrees.map((w) => {
                      const chats = (overview?.chats ?? []).filter(
                        (c) => c.worktreeId === w.id && matches(filter, c),
                      );
                      if (filter !== "all" && chats.length === 0) return null;
                      return (
                        <View key={w.id} className="border-border gap-1 border-l pl-3">
                          <Text className="text-sm">
                            {t("work.branch", { branch: w.branch, title: w.title })}
                          </Text>
                          {chats.map((c) => (
                            <ChatRow
                              key={c.id}
                              hostId={h.id}
                              chat={c}
                              profile={overview?.profiles.find((p) => p.id === c.profileId)?.name ?? null}
                            />
                          ))}
                        </View>
                      );
                    })}
                  </View>
                );
              })
            )}
          </CardContent>
        </Card>
      ))}
    </View>
  );
}
