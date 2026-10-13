import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

/** Keys a phone keyboard doesn't have, as the terminal encodes them. */
const KEYS = [
  ["esc", "\u001b"],
  ["tab", "\t"],
  ["ctrlC", "\u0003"],
  ["ctrlD", "\u0004"],
  ["up", "\u001b[A"],
  ["down", "\u001b[B"],
  ["left", "\u001b[D"],
  ["right", "\u001b[C"],
] as const;

export type TKeyBarProps = { onKey: (data: string) => void };

/** A row of keys under the terminal: Esc, Tab, Ctrl-C, Ctrl-D and the arrows. */
export function KeyBar({ onKey }: TKeyBarProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      className="border-border grow-0 border-t"
      contentContainerClassName="gap-1 px-2 py-2"
      keyboardShouldPersistTaps="always"
    >
      {KEYS.map(([name, data]) => (
        <Button
          key={name}
          size="sm"
          variant="outline"
          onPress={() => {
            onKey(data);
          }}
        >
          <Text>{t(`terminal.keys.${name}`)}</Text>
        </Button>
      ))}
    </ScrollView>
  );
}
