import type { TSharedConfig } from "@agentdeck/protocol";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

export type TSharedConfigEditorProps = {
  config: TSharedConfig;
  saving: boolean;
  saved: boolean;
  onSave: (instructions: string) => void;
};

/** Edit the shared instructions; see the MCP servers and skills (changed on the computer). */
export function SharedConfigEditor({
  config,
  saving,
  saved,
  onSave,
}: TSharedConfigEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? config.instructions;
  return (
    <View className="gap-2">
      <Text className="font-medium">{t("settings.shared.instructions")}</Text>
      <Text className="text-muted-foreground text-xs">{t("settings.shared.instructionsHint")}</Text>
      <Textarea
        value={text}
        onChangeText={setDraft}
        accessibilityLabel={t("settings.shared.instructions")}
        className="min-h-32 font-mono text-sm"
      />
      <View className="flex-row items-center gap-2">
        <Button
          size="sm"
          disabled={saving || draft === null || draft === config.instructions}
          onPress={() => {
            onSave(text);
          }}
        >
          <Text>{t("settings.shared.save")}</Text>
        </Button>
        {saved && (draft === null || draft === config.instructions) ? (
          <Text className="text-muted-foreground text-sm">{t("settings.shared.saved")}</Text>
        ) : null}
      </View>
      <Text className="mt-2 font-medium">{t("settings.shared.mcp")}</Text>
      {config.mcpServers.length === 0 ? (
        <Text className="text-muted-foreground text-sm">{t("settings.shared.mcpNone")}</Text>
      ) : (
        config.mcpServers.map((s) => (
          <Text key={s.name} className="text-sm">
            {t("settings.shared.server", {
              name: s.name,
              detail: s.type === "stdio" ? [s.command, ...s.args].join(" ") : s.url,
            })}
          </Text>
        ))
      )}
      <Text className="text-muted-foreground text-xs">{t("settings.shared.mcpHint")}</Text>
      <Text className="mt-2 font-medium">{t("settings.shared.skills")}</Text>
      <Text className="text-muted-foreground text-sm">
        {config.skills.length === 0 ? t("settings.shared.skillsNone") : config.skills.join(", ")}
      </Text>
    </View>
  );
}
