import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { z } from "zod";

import { PreviewPane, previewId, startPreview, stopPreview, usePreviewStore } from "@/modules/preview";
import { WorktreeTabs } from "@/modules/worktrees";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** The worktree's app, running on its computer, opened here through the relay (Phase 3c). */
export function WorktreePreviewPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const id = previewId(hostId, worktreeId);
  const preview = usePreviewStore((s) => s.open[id]);
  const status = usePreviewStore((s) => s.status[id]);
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
  const store = usePreviewStore.getState();
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="preview" />
      {preview ? (
        <PreviewPane
          preview={preview}
          status={status}
          busy={busy}
          onLoaded={() => {
            store.loaded(id);
          }}
          onReload={() => {
            store.reload(id);
          }}
          onWidth={(w) => {
            store.setWidth(id, w);
          }}
          onStop={() => {
            run(() => stopPreview(hostId, worktreeId));
          }}
        />
      ) : (
        <View className="gap-3 p-4">
          <Text className="text-muted-foreground">{t("preview.intro")}</Text>
          <Button
            disabled={busy}
            onPress={() => {
              run(() => startPreview(hostId, worktreeId));
            }}
          >
            <Text>{busy && status ? t(`preview.status.${status}`) : t("preview.start")}</Text>
          </Button>
        </View>
      )}
      {error ? <Text className="text-destructive px-4 py-2 text-sm">{error}</Text> : null}
    </View>
  );
}
