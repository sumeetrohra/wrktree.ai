import type { TPermissionDecision, TPermissionRequest } from "@agentdeck/protocol";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Text } from "@/shared/components/ui/text";

export type TPermissionSheetProps = {
  request: TPermissionRequest;
  busy: boolean;
  onRespond: (decision: TPermissionDecision, message?: string) => void;
};

/**
 * Pinned above the composer while a request is pending (spec: PermissionSheet): Allow once,
 * Always, Deny, and Deny with a message the agent reads.
 */
export function PermissionSheet({ request, busy, onRespond }: TPermissionSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [explaining, setExplaining] = useState(false);
  return (
    <View className="border-border bg-card gap-3 border-t p-4" accessibilityRole="alert">
      <Text variant="small" className="text-muted-foreground">
        {t("permission.asks")}
      </Text>
      <Text className="font-semibold">{request.title}</Text>
      {request.locations.length > 0 ? (
        <Text className="text-muted-foreground font-mono text-xs">{request.locations.join(", ")}</Text>
      ) : null}
      {explaining ? (
        <View className="gap-2">
          <Input
            placeholder={t("permission.messagePlaceholder")}
            value={message}
            onChangeText={setMessage}
            autoFocus
          />
          <Button
            variant="destructive"
            disabled={busy}
            onPress={() => {
              onRespond("deny", message.trim() || undefined);
            }}
          >
            <Text>{t("permission.denyWithMessage")}</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          <Button
            disabled={busy}
            onPress={() => {
              onRespond("allow_once");
            }}
          >
            <Text>{t("permission.allowOnce")}</Text>
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => {
              onRespond("allow_always");
            }}
          >
            <Text>{t("permission.allowAlways")}</Text>
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onPress={() => {
              onRespond("deny");
            }}
          >
            <Text>{t("permission.deny")}</Text>
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setExplaining(true);
            }}
          >
            <Text>{t("permission.denyAndSay")}</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
