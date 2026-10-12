import { useTranslation } from "react-i18next";

import { useHostsStore } from "@/lib/api";
import { Badge } from "@/shared/components/ui/badge";
import { Text } from "@/shared/components/ui/text";

/** One host's name and whether it is reachable right now. */
export function HostBadge({ hostId }: { hostId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const host = useHostsStore((s) => s.hosts.find((h) => h.id === hostId));
  const status = host?.status ?? "offline";
  return (
    <Badge
      variant={status === "online" ? "secondary" : "outline"}
      accessibilityLabel={t(`connection.${status}`)}
    >
      <Text>
        {t("connection.label", { name: host?.name ?? t("hosts.unknown"), status: t(`connection.${status}`) })}
      </Text>
    </Badge>
  );
}
