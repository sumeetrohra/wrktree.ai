import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";

export type TAgentMessageProps = { text: string; thought?: boolean };

/** The agent's reply (or, dimmed and italic, its thinking). */
export function AgentMessage({ text, thought = false }: TAgentMessageProps): React.JSX.Element {
  return (
    <View className="mr-12 self-start">
      <Text className={thought ? "text-muted-foreground italic" : "text-foreground"}>{text}</Text>
    </View>
  );
}
