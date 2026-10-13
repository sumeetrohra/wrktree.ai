import { worktreeIdSchema } from "@agentdeck/protocol";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { z } from "zod";

import { useChatsQuery } from "@/modules/chats";
import {
  ShipSheet,
  useDraftPrMutation,
  useGitStatusQuery,
  usePrStatusQuery,
  useShipMutation,
} from "@/modules/ship";
import { WorktreeTabs } from "@/modules/worktrees";

const paramsSchema = z.object({ hostId: z.string(), worktreeId: worktreeIdSchema });

/** Ship the worktree: commit, push, a PR the agent drafts, merge (or merge into base locally). */
export function WorktreeShipPage(): React.JSX.Element {
  const { hostId, worktreeId } = paramsSchema.parse(useLocalSearchParams());
  const status = useGitStatusQuery(hostId, worktreeId);
  const pr = usePrStatusQuery(hostId, worktreeId, status.data?.hasRemote === true);
  const ship = useShipMutation(hostId, worktreeId);
  const draft = useDraftPrMutation(hostId);
  const chats = useChatsQuery(hostId, worktreeId);
  const chat = [...(chats.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const error = ship.error?.message ?? draft.error?.message ?? status.error?.message ?? null;
  return (
    <View className="bg-background flex-1">
      <WorktreeTabs hostId={hostId} worktreeId={worktreeId} active="ship" />
      <ScrollView keyboardShouldPersistTaps="handled">
        <ShipSheet
          status={status.data}
          pr={pr.isError ? undefined : pr.data}
          prError={pr.error?.message ?? null}
          busy={ship.isPending}
          error={error}
          canDraft={chat !== undefined}
          drafting={draft.isPending}
          onAction={(action) => {
            ship.mutate(action);
          }}
          onDraft={() => (chat ? draft.mutateAsync(chat.id) : Promise.reject(new Error("no chat")))}
        />
      </ScrollView>
    </View>
  );
}
