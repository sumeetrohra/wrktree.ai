import { worktreeIdSchema } from "@agentdeck/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { FileEntryRow, fuzzyFilter, SearchResultRow, useSearchQuery, useTreeQuery } from "@/modules/files";
import { WorktreeTabs } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** The worktree's files: browse folders, filter names, or search contents (ripgrep on the host). */
export function WorktreeFilesPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const [dir, setDir] = useState("");
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const tree = useTreeQuery(hostId, worktreeId, dir);
  const search = useSearchQuery(hostId, worktreeId, query);
  const open = (path: string, line?: number): void => {
    router.push({
      pathname: "/h/[hostId]/wt/[worktreeId]/files/[...path]",
      params: { hostId, worktreeId, path: path.split("/"), ...(line ? { line: String(line) } : {}) },
    });
  };
  const entries = fuzzyFilter(filter, tree.data ?? [], (e) => e.name);
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="files" />
      <View className="gap-2 p-3">
        <Input
          placeholder={t("files.searchPlaceholder")}
          returnKeyType="search"
          onSubmitEditing={(e) => {
            setQuery(e.nativeEvent.text);
          }}
        />
        {query ? null : (
          <Input placeholder={t("files.filterPlaceholder")} value={filter} onChangeText={setFilter} />
        )}
      </View>
      <ScrollView contentContainerClassName="pb-6">
        {query ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onPress={() => {
                setQuery("");
              }}
            >
              <Text>{t("files.clearSearch")}</Text>
            </Button>
            {search.isPending ? <Skeleton className="mx-3 h-10" /> : null}
            {search.data?.matches.length === 0 ? (
              <Text className="text-muted-foreground px-4">{t("files.noMatches")}</Text>
            ) : null}
            {search.data?.matches.map((m) => (
              <SearchResultRow key={`${m.path}:${String(m.line)}`} match={m} onOpen={open} />
            ))}
            {search.data?.truncated ? (
              <Text className="text-muted-foreground px-4 text-xs">{t("files.truncated")}</Text>
            ) : null}
          </>
        ) : (
          <>
            {dir ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onPress={() => {
                  setDir(dir.split("/").slice(0, -1).join("/"));
                  setFilter("");
                }}
              >
                <Text className="font-mono">{t("files.up", { dir })}</Text>
              </Button>
            ) : null}
            {tree.isPending ? <Skeleton className="mx-3 h-10" /> : null}
            {entries.map((e) => (
              <FileEntryRow
                key={e.path}
                entry={e}
                onOpen={(entry) => {
                  if (entry.type === "dir") {
                    setDir(entry.path);
                    setFilter("");
                  } else open(entry.path);
                }}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
