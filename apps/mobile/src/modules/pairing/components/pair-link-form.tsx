import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { linkToOffer, type TPairingOffer } from "@/lib/api";
import { clipboardText } from "@/lib/media";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Text } from "@/shared/components/ui/text";

export type TPairLinkFormProps = { onOffer: (offer: TPairingOffer) => void };

/** Paste the link `agentdeck pair` printed (the same thing the QR code holds). */
export function PairLinkForm({ onOffer }: TPairLinkFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [link, setLink] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (value: string): void => {
    const offer = linkToOffer(value);
    setInvalid(offer === null);
    if (offer) onOffer(offer);
  };
  return (
    <View className="gap-3">
      <Label nativeID="pair-link">{t("pairing.linkLabel")}</Label>
      <Input
        aria-labelledby="pair-link"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t("pairing.linkPlaceholder")}
        value={link}
        onChangeText={(v) => {
          setLink(v);
          setInvalid(false);
        }}
      />
      {invalid ? <Text className="text-destructive">{t("pairing.invalidLink")}</Text> : null}
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          onPress={() => {
            void clipboardText().then((v) => {
              setLink(v);
              submit(v);
            });
          }}
        >
          <Text>{t("pairing.paste")}</Text>
        </Button>
        <Button
          disabled={link.trim().length === 0}
          onPress={() => {
            submit(link);
          }}
        >
          <Text>{t("pairing.continue")}</Text>
        </Button>
      </View>
    </View>
  );
}
