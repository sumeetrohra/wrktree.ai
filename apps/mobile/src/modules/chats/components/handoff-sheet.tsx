import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type THandoffTarget = { id: string; name: string; agent: string };

export type THandoffSheetProps = {
  profiles: readonly THandoffTarget[];
  busy: boolean;
  error: string | null;
  onPick: (profileId: string) => void;
  onClose: () => void;
};

/** "Continue on…": pick the profile (and so the agent) to carry this chat on (Phase 4b). */
export function HandoffSheet({
  profiles,
  busy,
  error,
  onPick,
  onClose,
}: THandoffSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="border-border bg-card gap-2 border-t p-4" accessibilityRole="menu">
      <Text className="font-semibold">{t("chat.handoff.title")}</Text>
      <Text className="text-muted-foreground text-sm">{t("chat.handoff.hint")}</Text>
      {profiles.map((p) => (
        <Button
          key={p.id}
          variant="outline"
          disabled={busy}
          onPress={() => {
            onPick(p.id);
          }}
        >
          <Text>{t("chat.handoff.on", { name: p.name, agent: p.agent })}</Text>
        </Button>
      ))}
      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
      <Button variant="ghost" onPress={onClose}>
        <Text>{t("chat.handoff.cancel")}</Text>
      </Button>
    </View>
  );
}
