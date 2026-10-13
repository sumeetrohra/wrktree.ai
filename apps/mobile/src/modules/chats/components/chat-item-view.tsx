import type { TChatItem } from "@agentdeck/protocol";
import { View } from "react-native";

import { AgentMessage } from "./agent-message";
import { CloudImage } from "./cloud-image";
import { PlanCard } from "./plan-card";
import { SystemNote } from "./system-note";
import { ToolCard } from "./tool-card";
import { UserMessage } from "./user-message";

/** Files of an item kept in cloud storage (cloud history only). */
export type TItemFiles = readonly { storagePath: string; mime: string }[];

export type TChatItemViewProps = { item: TChatItem; files?: TItemFiles | undefined };

/** One renderer per `ChatItem.kind` (spec: ChatList). */
export function ChatItemView({ item, files }: TChatItemViewProps): React.JSX.Element {
  switch (item.kind) {
    case "user": {
      const images = (files ?? []).filter((f) => f.mime.startsWith("image/"));
      return (
        <UserMessage
          text={item.text}
          attachments={item.attachments.length}
          context={item.context ?? []}
          images={
            images.length === 0 ? undefined : (
              <View className="flex-row flex-wrap gap-2">
                {images.map((f) => (
                  <CloudImage key={f.storagePath} storagePath={f.storagePath} mime={f.mime} />
                ))}
              </View>
            )
          }
        />
      );
    }
    case "agent_text":
      return <AgentMessage text={item.text} />;
    case "thought":
      return <AgentMessage text={item.text} thought />;
    case "tool":
      return <ToolCard item={item} />;
    case "plan":
      return <PlanCard entries={item.entries} />;
    case "system":
      return <SystemNote text={item.text} level={item.level} />;
  }
}
