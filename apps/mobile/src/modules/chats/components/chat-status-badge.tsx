import type { TChatStatus } from "@agentdeck/protocol";
import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";
import { Text } from "@/shared/components/ui/text";

export type TChatStatusBadgeProps = { status: TChatStatus | null };

export function ChatStatusBadge({ status }: TChatStatusBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (status === null) return null;
  const variant =
    status === "crashed" || status === "limited"
      ? "destructive"
      : status === "running"
        ? "default"
        : "secondary";
  return (
    <Badge variant={variant}>
      <Text>{t(`chat.status.${status}`)}</Text>
    </Badge>
  );
}
