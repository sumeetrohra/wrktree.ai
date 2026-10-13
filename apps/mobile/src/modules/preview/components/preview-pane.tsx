import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { WebFrame } from "@/lib/webview";
import { Button } from "@/shared/components/ui/button";
import { Text } from "@/shared/components/ui/text";
import { cn } from "@/shared/utils/cn.utils";

import {
  frameUrl,
  type TOpenPreview,
  type TPreviewStatus,
  type TPreviewWidth,
} from "../stores/preview.store";

const WIDTHS: readonly TPreviewWidth[] = ["phone", "tablet", "full"];
const WIDTH_CLASS: Record<TPreviewWidth, string> = {
  phone: "w-[390px] max-w-full",
  tablet: "w-[820px] max-w-full",
  full: "w-full",
};

export type TPreviewPaneProps = {
  preview: TOpenPreview;
  status: TPreviewStatus | undefined;
  busy: boolean;
  onLoaded: () => void;
  onReload: () => void;
  onWidth: (w: TPreviewWidth) => void;
  onStop: () => void;
};

/** The running app: a bar (status, reload, width, stop) over the page. */
export function PreviewPane({
  preview,
  status,
  busy,
  onLoaded,
  onReload,
  onWidth,
  onStop,
}: TPreviewPaneProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View className="flex-1">
      <View className="border-border flex-row flex-wrap items-center gap-1 border-b px-2 py-2">
        <Text className="text-muted-foreground mr-2 text-xs" numberOfLines={1}>
          {status ? t(`preview.status.${status}`) : null}
        </Text>
        <Button size="sm" variant="outline" onPress={onReload}>
          <Text>{t("preview.reload")}</Text>
        </Button>
        {WIDTHS.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={preview.width === w ? "secondary" : "ghost"}
            onPress={() => {
              onWidth(w);
            }}
          >
            <Text>{t(`preview.widths.${w}`)}</Text>
          </Button>
        ))}
        <Button size="sm" variant="destructive" disabled={busy} onPress={onStop}>
          <Text>{t("preview.stop")}</Text>
        </Button>
      </View>
      <View className="bg-muted flex-1 items-center">
        <View className={cn("bg-background flex-1", WIDTH_CLASS[preview.width])}>
          <WebFrame
            key={preview.loads}
            url={frameUrl(preview)}
            label={t("preview.frame")}
            onLoad={onLoaded}
          />
        </View>
      </View>
    </View>
  );
}
