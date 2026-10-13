import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TWorktreeTab = "chats" | "changes" | "files" | "logs" | "ship";
export type TEditor = "vscode" | "cursor" | "zed";

const PATHS = {
  chats: "/h/[hostId]/wt/[worktreeId]",
  changes: "/h/[hostId]/wt/[worktreeId]/changes",
  files: "/h/[hostId]/wt/[worktreeId]/files",
  logs: "/h/[hostId]/wt/[worktreeId]/logs",
  ship: "/h/[hostId]/wt/[worktreeId]/ship",
} as const;
const TABS: readonly TWorktreeTab[] = ["chats", "changes", "files", "logs", "ship"];

export type TWorktreeTabsProps = {
  hostId: string;
  worktreeId: string;
  active: TWorktreeTab;
  /** Only for this computer's own worktrees (desktop web): open them in a desktop editor. */
  onOpenEditor?: ((editor: TEditor) => void) | undefined;
};

/** The worktree screen's top tabs (spec: Chats | Changes | Files | Logs), plus Ship. */
export function WorktreeTabs({
  hostId,
  worktreeId,
  active,
  onOpenEditor,
}: TWorktreeTabsProps): React.JSX.Element {
  const { t } = useTranslation();
  const [editors, setEditors] = useState(false);
  return (
    <View className="border-border border-b">
      <ScrollView
        horizontal
        contentContainerClassName="gap-1 px-2 py-2"
        showsHorizontalScrollIndicator={false}
      >
        {TABS.map((tab) => (
          <Button
            key={tab}
            size="sm"
            variant={tab === active ? "secondary" : "ghost"}
            onPress={() => {
              if (tab !== active) router.replace({ pathname: PATHS[tab], params: { hostId, worktreeId } });
            }}
          >
            <Text>{t(`worktree.tabs.${tab}`)}</Text>
          </Button>
        ))}
        {onOpenEditor ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setEditors(!editors);
            }}
          >
            <Text>{t("worktree.openInEditor")}</Text>
          </Button>
        ) : null}
      </ScrollView>
      {onOpenEditor && editors ? (
        <View className="flex-row gap-1 px-2 pb-2">
          {(["vscode", "cursor", "zed"] as const).map((e) => (
            <Button
              key={e}
              size="sm"
              variant="outline"
              onPress={() => {
                setEditors(false);
                onOpenEditor(e);
              }}
            >
              <Text>{t(`worktree.editors.${e}`)}</Text>
            </Button>
          ))}
        </View>
      ) : null}
    </View>
  );
}
