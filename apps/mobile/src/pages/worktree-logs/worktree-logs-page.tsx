import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { z } from "zod";

import {
  followProc,
  LogView,
  ScriptRow,
  startProc,
  stopProc,
  useProcLogStore,
  useProcsQuery,
} from "@/modules/procs";
import { WorktreeTabs } from "@/modules/worktrees";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** The repo's scripts (`.agentdeck/config.json` `scripts`): start, stop, and their live output. */
export function WorktreeLogsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const procs = useProcsQuery(hostId, worktreeId);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useProcLogStore((s) => (shown ? s.logs[shown]?.text : undefined));
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
  const latest = (script: string) => procs.data?.procs.filter((p) => p.script === script).at(-1);
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="logs" />
      {procs.isPending ? <Skeleton className="m-3 h-10" /> : null}
      {procs.data?.scripts.length === 0 ? (
        <Text className="text-muted-foreground p-4">{t("logs.noScripts")}</Text>
      ) : null}
      {procs.data?.scripts.map((script) => {
        const proc = latest(script);
        return (
          <ScriptRow
            key={script}
            script={script}
            proc={proc}
            selected={shown !== null && proc?.id === shown}
            busy={busy}
            onStart={() => {
              run(async () => {
                const p = await startProc(hostId, worktreeId, script);
                setShown(p.id);
              });
            }}
            onStop={(procId) => {
              run(() => stopProc(hostId, procId));
            }}
            onShow={(procId) => {
              setShown(procId);
              run(() => followProc(hostId, procId));
            }}
          />
        );
      })}
      {error ? <Text className="text-destructive px-4 text-sm">{error}</Text> : null}
      <View className="border-border mt-2 flex-1 border-t">
        {shown ? (
          <LogView text={log ?? ""} />
        ) : (
          <Text className="text-muted-foreground p-4">{t("logs.pick")}</Text>
        )}
      </View>
    </View>
  );
}
