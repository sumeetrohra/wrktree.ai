import type { TChatItem } from "@agentdeck/protocol";
import { FlashList } from "@shopify/flash-list";
import { View } from "react-native";

import { ChatItemView, type TItemFiles } from "./chat-item-view";

export type TChatListProps = {
  items: readonly TChatItem[];
  /** Cloud history: each item's files in cloud storage, by item id. */
  files?: ReadonlyMap<string, TItemFiles> | undefined;
};

/** The conversation, newest at the bottom, staying pinned there while the agent streams. */
export function ChatList({ items, files }: TChatListProps): React.JSX.Element {
  return (
    <FlashList
      data={items}
      keyExtractor={(i) => i.id}
      getItemType={(i) => i.kind}
      maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
      renderItem={({ item }) => (
        <View className="px-4 py-1.5">
          <ChatItemView item={item} files={files?.get(item.id)} />
        </View>
      )}
    />
  );
}
