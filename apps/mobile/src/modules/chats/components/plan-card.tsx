import type { TPlanEntry } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Text } from "@/shared/components/ui/text";

export type TPlanCardProps = { entries: readonly TPlanEntry[] };

const MARK: Record<TPlanEntry["status"], string> = { pending: "○", in_progress: "◐", done: "●" };

/** The agent's plan, with each step's state. */
export function PlanCard({ entries }: TPlanCardProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="bg-muted gap-1 rounded-lg p-3">
      <Text variant="small">{t("chat.plan")}</Text>
      {entries.map((e, i) => (
        <Text
          key={`${String(i)}-${e.text}`}
          className={e.status === "done" ? "text-muted-foreground" : "text-foreground"}
        >
          {t("chat.planEntry", { mark: MARK[e.status], text: e.text })}
        </Text>
      ))}
    </View>
  );
}
