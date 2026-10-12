import type { TChatItem } from "@agentdeck/protocol";

import { AgentMessage } from "./agent-message";
import { PlanCard } from "./plan-card";
import { SystemNote } from "./system-note";
import { ToolCard } from "./tool-card";
import { UserMessage } from "./user-message";

export type TChatItemViewProps = { item: TChatItem };

/** One renderer per `ChatItem.kind` (spec: ChatList). */
export function ChatItemView({ item }: TChatItemViewProps): React.JSX.Element {
  switch (item.kind) {
    case "user":
      return <UserMessage text={item.text} attachments={item.attachments.length} />;
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
