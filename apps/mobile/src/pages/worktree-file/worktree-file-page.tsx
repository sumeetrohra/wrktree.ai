import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useColorScheme, View } from "react-native";
import { z } from "zod";

import { LOCAL_HOST } from "@/lib/api";
import { askAboutLines, useChatsQuery } from "@/modules/chats";
import { AskBar, CodeView, linesOf, useHighlightQuery, type TLineRange } from "@/modules/code";
import { useFileTextQuery } from "@/modules/files";
import { openInEditor } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({
  hostId: z.string(),
  worktreeId: worktreeIdSchema,
  path: z.union([z.string(), z.array(z.string())]),
  line: z.coerce.number().int().positive().optional().catch(undefined),
});

/** One file, colored and virtualized (`?line=` opens at a line); select lines to ask about them. */
export function WorktreeFilePage(): React.JSX.Element {
  const { t } = useTranslation();
  const p = paramsSchema.parse(useLocalSearchParams());
  const path = Array.isArray(p.path) ? p.path.join("/") : p.path;
  const dark = useColorScheme() === "dark";
  const [selection, setSelection] = useState<TLineRange | null>(null);
  const file = useFileTextQuery(p.hostId, p.worktreeId, path);
  const lines = file.data === undefined ? undefined : linesOf(file.data.text);
  const tokens = useHighlightQuery(`${p.worktreeId}:${String(file.dataUpdatedAt)}`, path, lines, dark);
  const chats = useChatsQuery(p.hostId, p.worktreeId);
  const chat = [...(chats.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    <View className="bg-background flex-1">
      <View className="border-border flex-row items-center gap-2 border-b px-4 py-2">
        <Text className="flex-1 font-mono text-xs" numberOfLines={1}>
          {path}
        </Text>
        {p.hostId === LOCAL_HOST ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              void openInEditor(p.hostId, p.worktreeId, "vscode", { path, line: selection?.line ?? p.line });
            }}
          >
            <Text>{t("worktree.editors.vscode")}</Text>
          </Button>
        ) : null}
      </View>
      {file.data?.truncated ? (
        <Text className="text-muted-foreground px-4 text-xs">{t("files.fileTruncated")}</Text>
      ) : null}
      {file.isError ? <Text className="text-destructive p-4">{file.error.message}</Text> : null}
      {file.isPending ? <Skeleton className="m-4 h-40" /> : null}
      <View className="flex-1">
        {lines ? (
          <CodeView
            lines={lines}
            tokens={tokens.data}
            focusLine={p.line}
            selection={selection}
            onSelect={setSelection}
          />
        ) : null}
      </View>
      {selection ? (
        <AskBar
          path={path}
          selection={selection}
          canAsk={chat !== undefined}
          onClear={() => {
            setSelection(null);
          }}
          onAsk={() => {
            if (chat) askAboutLines(p.hostId, chat.id, { path, ...selection });
          }}
        />
      ) : null}
    </View>
  );
}
