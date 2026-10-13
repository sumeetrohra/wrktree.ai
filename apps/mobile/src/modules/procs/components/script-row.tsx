import type { TProc } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";

export type TScriptRowProps = {
  script: string;
  /** The newest process of this script, if any. */
  proc: TProc | undefined;
  selected: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: (procId: string) => void;
  onShow: (procId: string) => void;
};

/** One of the repo's scripts: its state, Start or Stop, and showing its log. */
export function ScriptRow({
  script,
  proc,
  selected,
  busy,
  onStart,
  onStop,
  onShow,
}: TScriptRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const running = proc?.status === "running";
  return (
    <View className="flex-row items-center gap-2 px-3 py-2">
      <Button
        variant={selected ? "secondary" : "ghost"}
        size="sm"
        className="flex-1 justify-start"
        disabled={!proc}
        onPress={() => {
          if (proc) onShow(proc.id);
        }}
      >
        <Text className="font-mono">{script}</Text>
      </Button>
      {proc ? (
        <Badge variant={proc.status === "crashed" ? "destructive" : "outline"}>
          <Text>
            {proc.exitCode === null
              ? t(`logs.status.${proc.status}`)
              : t("logs.exited", { status: t(`logs.status.${proc.status}`), code: proc.exitCode })}
          </Text>
        </Badge>
      ) : null}
      {running ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onPress={() => {
            onStop(proc.id);
          }}
        >
          <Text>{t("logs.stop")}</Text>
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onPress={onStart}>
          <Text>{t("logs.start")}</Text>
        </Button>
      )}
    </View>
  );
}
