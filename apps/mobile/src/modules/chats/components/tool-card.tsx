import type { TChatItem } from "@agentdeck/protocol";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TToolCardProps = { item: Extract<TChatItem, { kind: "tool" }> };

/** A tool call, collapsed to one line until tapped (spec: tool cards collapse by default). */
export function ToolCard({ item }: TToolCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const variant = item.status === "failed" ? "destructive" : item.status === "done" ? "secondary" : "outline";
  return (
    <View className="border-border rounded-lg border">
      <Button
        variant="ghost"
        className="justify-between"
        accessibilityLabel={item.title}
        onPress={() => {
          setOpen((o) => !o);
        }}
      >
        <Text className="flex-1" numberOfLines={1}>
          {item.title}
        </Text>
        <Badge variant={variant}>
          <Text>{t(`chat.tool.${item.status}`)}</Text>
        </Badge>
      </Button>
      {open && item.locations?.length ? (
        <View className="gap-1 px-4 pb-3">
          {item.locations.map((l) => (
            <Text key={l} className="text-muted-foreground font-mono text-xs">
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
