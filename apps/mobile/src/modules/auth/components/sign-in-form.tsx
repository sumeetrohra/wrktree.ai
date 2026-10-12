import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Text } from "@/shared/components/ui/text";

export type TSignInFormProps = {
  /** The code has been sent: show the code field. */
  codeSent: boolean;
  busy: boolean;
  error: string | null;
  onRequestCode: (email: string) => void;
  onSubmitCode: (email: string, code: string) => void;
};

/** Magic-link sign-in: an email address, then the six-digit code from the email. */
export function SignInForm({
  codeSent,
  busy,
  error,
  onRequestCode,
  onSubmitCode,
}: TSignInFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Label nativeID="email">{t("auth.email")}</Label>
        <Input
          aria-labelledby="email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder={t("auth.emailPlaceholder")}
          value={email}
          editable={!codeSent}
          onChangeText={setEmail}
        />
      </View>
      {codeSent ? (
        <View className="gap-1.5">
          <Label nativeID="code">{t("auth.code")}</Label>
          <Input
            aria-labelledby="code"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder={t("auth.codePlaceholder")}
            value={code}
            onChangeText={setCode}
          />
        </View>
      ) : null}
      {error === null ? null : <Text className="text-destructive">{error}</Text>}
      <Button
        disabled={busy || (codeSent ? code.length !== 6 : !email.includes("@"))}
        onPress={() => {
          if (codeSent) onSubmitCode(email.trim(), code);
          else onRequestCode(email.trim());
        }}
      >
        <Text>{codeSent ? t("auth.verify") : t("auth.sendCode")}</Text>
      </Button>
    </View>
  );
}
