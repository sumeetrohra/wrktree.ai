import type { TBlobRef } from "@agentdeck/protocol";
import { Camera, ClipboardPaste, Film, ImagePlus, Mic, MicOff, SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";

import {
  clipboardImage,
  MAX_VIDEO_BYTES,
  pickImage,
  pickVideo,
  takePhoto,
  VideoTooLargeError,
  type TPickedImage,
} from "@/lib/media";
import { dictationAvailable, startDictation } from "@/lib/speech";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Icon } from "@/shared/components/ui/icon";
import { Text } from "@/shared/components/ui/text";
import { Textarea } from "@/shared/components/ui/textarea";

import { DictationSession } from "../utils/dictation.utils";

export type TComposerProps = {
  /** True while the agent is working: messages queue for the next turn. */
  agentBusy: boolean;
  upload: (base64: string, mime: string) => Promise<TBlobRef>;
  onSend: (text: string, attachments: TBlobRef[]) => void;
};

/** Multiline input with image attachments; sends, or queues while a turn is running (spec: Composer). */
export function Composer({ agentBusy, upload, onSend }: TComposerProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<TBlobRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [canDictate] = useState(dictationAvailable);
  const [dictation, setDictation] = useState<DictationSession | null>(null);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const toggleDictation = (): void => {
    if (dictation) {
      dictation.stop?.();
      return;
    }
    const session = new DictationSession(text);
    setDictation(session);
    setDictationError(null);
    startDictation(i18n.language, {
      onText: (said, final) => {
        setText(session.result(said, final));
      },
      onEnd: () => {
        setDictation(null);
      },
      onError: (message) => {
        setDictationError(message);
      },
    })
      .then((stop) => {
        session.stop = stop;
      })
      .catch(() => {
        setDictation(null);
        setDictationError(t("composer.dictationDenied"));
      });
  };
  const [attachError, setAttachError] = useState<string | null>(null);
  const attach = async (source: () => Promise<TPickedImage | null>): Promise<void> => {
    setAttachError(null);
    let picked: TPickedImage | null;
    try {
      picked = await source();
    } catch (e) {
      setAttachError(
        e instanceof VideoTooLargeError
          ? t("composer.videoTooLarge", { mb: Math.round(MAX_VIDEO_BYTES / 1024 / 1024) })
          : t("composer.attachFailed"),
      );
      return;
    }
    if (!picked) return;
    setUploading(true);
    try {
      const ref = await upload(picked.base64, picked.mime);
      setAttachments((a) => [...a, ref]);
    } catch {
      setAttachError(t("composer.attachFailed"));
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
      {dictationError ? <Text className="text-destructive text-sm">{dictationError}</Text> : null}
      {attachError ? <Text className="text-destructive text-sm">{attachError}</Text> : null}
      {uploading ? <Text className="text-muted-foreground text-sm">{t("composer.uploading")}</Text> : null}
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
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={t("composer.attachVideo")}
          disabled={uploading}
          onPress={() => {
            void attach(pickVideo);
          }}
        >
          <Icon as={Film} />
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
        {canDictate ? (
          <Button
            variant={dictation ? "secondary" : "ghost"}
            size="icon"
            accessibilityLabel={dictation ? t("composer.dictateStop") : t("composer.dictate")}
            onPress={toggleDictation}
          >
            <Icon as={dictation ? MicOff : Mic} />
          </Button>
        ) : null}
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
