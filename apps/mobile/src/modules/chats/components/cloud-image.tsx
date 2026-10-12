import { useTranslation } from "react-i18next";
import { Image } from "react-native";

import { Skeleton } from "@/shared/components/ui/skeleton";

import { useCloudFileQuery } from "../api/cloud-items.queries";

/** An image attached to a chat, loaded from cloud storage. */
export function CloudImage({ storagePath, mime }: { storagePath: string; mime: string }): React.JSX.Element {
  const { t } = useTranslation();
  const uri = useCloudFileQuery(storagePath, mime);
  if (!uri.data) return <Skeleton className="h-32 w-32 rounded-lg" />;
  return (
    <Image
      source={{ uri: uri.data }}
      accessibilityLabel={t("chat.image")}
      className="h-32 w-32 rounded-lg"
      resizeMode="cover"
    />
  );
}
