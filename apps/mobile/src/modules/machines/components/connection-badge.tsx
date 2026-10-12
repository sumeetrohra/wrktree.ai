import { useTranslation } from "react-i18next";

import { useConnectionStore } from "@/lib/api";
import { Badge } from "@/shared/components/ui/badge";
import { Text } from "@/shared/components/ui/text";

/** The paired machine and whether it is reachable right now. */
export function ConnectionBadge(): React.JSX.Element {
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  const name = useConnectionStore((s) => s.machineName);
  const variant = status === "online" ? "secondary" : status === "revoked" ? "destructive" : "outline";
  return (
    <Badge variant={variant} accessibilityLabel={t(`connection.${status}`)}>
      <Text>{t("connection.label", { name: name ?? "", status: t(`connection.${status}`) })}</Text>
    </Badge>
  );
}
