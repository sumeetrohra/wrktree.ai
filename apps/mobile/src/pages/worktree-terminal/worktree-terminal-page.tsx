import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { z } from "zod";

import {
  TerminalPane,
  closeTerminal,
  followTerminal,
  openTerminal,
  resizeTerminal,
  sendInput,
  useTerminalStore,
  useTerminalsQuery,
} from "@/modules/terminal";
import { WorktreeTabs } from "@/modules/worktrees";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** Shells in the worktree, on its computer (Phase 5). */
export function WorktreeTerminalPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const list = useTerminalsQuery(hostId, worktreeId);
  const currentId = useTerminalStore((s) => s.current[`${hostId}:${worktreeId}`]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    work()
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const terminals = list.data?.terminals ?? [];
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="terminal" />
      {list.data && !list.data.enabled ? (
        <View className="gap-2 p-4">
          <Text className="font-medium">{t("terminal.off.title")}</Text>
          <Text className="text-muted-foreground">{t("terminal.off.body")}</Text>
          <Text className="font-mono text-sm">{t("terminal.off.command")}</Text>
        </View>
      ) : (
        <TerminalPane
          terminals={terminals}
          current={terminals.find((x) => x.id === currentId)}
          busy={busy}
          onOpen={() => {
            run(() => openTerminal(hostId, worktreeId));
          }}
          onShow={(term) => {
            run(async () => {
              await followTerminal(hostId, term.id);
              useTerminalStore.getState().show(hostId, worktreeId, term.id);
            });
          }}
          onClose={(term) => {
            run(() => closeTerminal(hostId, term));
          }}
          onInput={(termId, data) => {
            sendInput(hostId, termId, data);
          }}
          onResize={(termId, cols, rows) => {
            resizeTerminal(hostId, termId, cols, rows);
          }}
        />
      )}
      {error ? <Text className="text-destructive px-4 py-2 text-sm">{error}</Text> : null}
    </View>
  );
}
