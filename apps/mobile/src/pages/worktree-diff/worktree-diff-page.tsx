import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useColorScheme, View } from "react-native";
import { z } from "zod";

import { useFileDiffQuery } from "@/modules/changes";
import { askAboutLines, useChatsQuery } from "@/modules/chats";
import {
  AskBar,
  DiffView,
  parseUnifiedDiff,
  useBlobTextQuery,
  useHighlightQuery,
  type TLineRange,
} from "@/modules/code";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({
  hostId: z.string(),
  worktreeId: worktreeIdSchema,
  path: z.union([z.string(), z.array(z.string())]),
  against: z.enum(["base", "head"]).catch("base"),
});

/** One file's diff, colored; select lines to ask the worktree's agent about them. */
export function WorktreeDiffPage(): React.JSX.Element {
  const { t } = useTranslation();
  const p = paramsSchema.parse(useLocalSearchParams());
  const path = Array.isArray(p.path) ? p.path.join("/") : p.path;
  const dark = useColorScheme() === "dark";
  const [selection, setSelection] = useState<TLineRange | null>(null);
  const blobId = useFileDiffQuery(p.hostId, p.worktreeId, path, p.against);
  const text = useBlobTextQuery(p.hostId, blobId.data);
  const rows = text.data === undefined ? undefined : parseUnifiedDiff(text.data);
  const tokens = useHighlightQuery(
    blobId.data ?? "",
    path,
    rows?.map((r) => r.text),
    dark,
  );
  const chats = useChatsQuery(p.hostId, p.worktreeId);
  const chat = [...(chats.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    <View className="bg-background flex-1">
      <Text className="border-border border-b px-4 py-2 font-mono text-xs" numberOfLines={1}>
        {path}
      </Text>
      {blobId.isError ? <Text className="text-muted-foreground p-4">{t("changes.noDiff")}</Text> : null}
      {rows === undefined && !blobId.isError ? <Skeleton className="m-4 h-40" /> : null}
      <View className="flex-1">
        {rows ? (
          <DiffView rows={rows} tokens={tokens.data} selection={selection} onSelect={setSelection} />
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
