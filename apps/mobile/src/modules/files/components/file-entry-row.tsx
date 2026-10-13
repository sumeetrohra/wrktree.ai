import type { TFsEntry } from "@agentdeck/protocol";
import { File, Folder } from "lucide-react-native";

import { Button } from "@/shared/components/ui/button";
import { Icon } from "@/shared/components/ui/icon";
import { Text } from "@/shared/components/ui/text";

export type TFileEntryRowProps = { entry: TFsEntry; onOpen: (entry: TFsEntry) => void };

/** A folder or file in the explorer. */
export function FileEntryRow({ entry, onOpen }: TFileEntryRowProps): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      className="h-auto justify-start gap-2 px-3 py-2"
      onPress={() => {
        onOpen(entry);
      }}
    >
      <Icon as={entry.type === "dir" ? Folder : File} className="text-muted-foreground size-4" />
      <Text className="flex-1 font-mono text-xs" numberOfLines={1}>
        {entry.name}
      </Text>
    </Button>
  );
}
