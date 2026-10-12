import type { TBlobRef } from "@agentdeck/protocol";
import { Camera, ClipboardPaste, ImagePlus, SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";

import { clipboardImage, pickImage, takePhoto, type TPickedImage } from "@/lib/media";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Icon } from "@/shared/components/ui/icon";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

export type TComposerProps = {
  /** True while the agent is working: messages queue for the next turn. */
  agentBusy: boolean;
  upload: (base64: string, mime: string) => Promise<TBlobRef>;
  onSend: (text: string, attachments: TBlobRef[]) => void;
};

/** Multiline input with image attachments; sends, or queues while a turn is running (spec: Composer). */
export function Composer({ agentBusy, upload, onSend }: TComposerProps): React.JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<TBlobRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const attach = async (source: () => Promise<TPickedImage | null>): Promise<void> => {
    const img = await source();
    if (!img) return;
    setUploading(true);
    try {
      const ref = await upload(img.base64, img.mime);
      setAttachments((a) => [...a, ref]);
    } finally {
      setUploading(false);
    }
  };
  const send = (): void => {
    const body = text.trim();
    if (!body) return;
    onSend(body, attachments);
    setText("");
    setAttachments([]);
  };
  return (
    <View className="border-border gap-2 border-t p-3">
      {attachments.length > 0 ? (
        <Badge variant="secondary" className="self-start">
          <Text>{t("composer.attached", { count: attachments.length })}</Text>
        </Badge>
      ) : null}
      <View className="flex-row items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={t("composer.attach")}
          disabled={uploading}
          onPress={() => {
            void attach(pickImage);
          }}
        >
          <Icon as={ImagePlus} />
        </Button>
        {Platform.OS === "web" ? null : (
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={t("composer.camera")}
            disabled={uploading}
            onPress={() => {
              void attach(takePhoto);
            }}
          >
            <Icon as={Camera} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={t("composer.pasteImage")}
          disabled={uploading}
          onPress={() => {
            void attach(clipboardImage);
          }}
        >
          <Icon as={ClipboardPaste} />
        </Button>
        <Textarea
          className="min-h-10 flex-1"
          placeholder={agentBusy ? t("composer.queuePlaceholder") : t("composer.placeholder")}
          value={text}
          onChangeText={setText}
          aria-label={t("composer.label")}
        />
        <Button
          size="icon"
          accessibilityLabel={agentBusy ? t("composer.queue") : t("composer.send")}
          disabled={!text.trim() || uploading}
          onPress={send}
        >
          <Icon as={SendHorizontal} className="text-primary-foreground" />
        </Button>
      </View>
    </View>
  );
}
