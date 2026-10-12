import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Text } from "@/shared/components/ui/text";

const CODE = /^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/;

/** The code from a QR or link: `…/link?code=ABCD-EFGH`, or the code itself. */
export function codeFrom(text: string): string | null {
  const trimmed = text.trim();
  const fromUrl = /[?&]code=([A-Za-z2-9-]{8,9})/.exec(trimmed)?.[1];
  const code = fromUrl ?? trimmed;
  return CODE.test(code) ? code.toUpperCase() : null;
}

export type TLinkCodeFormProps = {
  initialCode: string;
  busy: boolean;
  error: string | null;
  onApprove: (code: string) => void;
};

/** Approve a computer: the code `agentdeck login` shows. */
export function LinkCodeForm({ initialCode, busy, error, onApprove }: TLinkCodeFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [code, setCode] = useState(initialCode);
  const parsed = codeFrom(code);
  return (
    <View className="gap-3">
      <Label nativeID="link-code">{t("link.codeLabel")}</Label>
      <Input
        aria-labelledby="link-code"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-EFGH"
        value={code}
        onChangeText={setCode}
      />
      {error === null ? null : <Text className="text-destructive">{error}</Text>}
      <Button
        disabled={busy || parsed === null}
        onPress={() => {
          if (parsed !== null) onApprove(parsed);
        }}
      >
        <Text>{t("link.approve")}</Text>
      </Button>
    </View>
  );
}
