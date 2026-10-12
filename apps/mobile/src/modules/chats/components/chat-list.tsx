import type { TChatItem } from "@agentdeck/protocol";
import { FlashList } from "@shopify/flash-list";
import { View } from "react-native";

import { ChatItemView } from "./chat-item-view";

export type TChatListProps = { items: readonly TChatItem[] };

/** The conversation, newest at the bottom, staying pinned there while the agent streams. */
export function ChatList({ items }: TChatListProps): React.JSX.Element {
  return (
    <FlashList
      data={items}
      keyExtractor={(i) => i.id}
      getItemType={(i) => i.kind}
      maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
      renderItem={({ item }) => (
        <View className="px-4 py-1.5">
          <ChatItemView item={item} />
        </View>
      )}
    />
  );
}
