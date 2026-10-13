import { FlashList } from "@shopify/flash-list";

import { Text } from "@/shared/components/ui/text";

export type TLogViewProps = { text: string };

/** A process's output as virtualized monospace lines, pinned to the newest. */
export function LogView({ text }: TLogViewProps): React.JSX.Element {
  const lines = text.split("\n");
  return (
    <FlashList
      data={lines}
      keyExtractor={(_, i) => String(i)}
      maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 }}
      renderItem={({ item }) => <Text className="px-3 font-mono text-xs leading-5">{item || " "}</Text>}
    />
  );
}
