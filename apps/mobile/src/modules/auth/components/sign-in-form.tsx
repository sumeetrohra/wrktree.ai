import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Separator } from "@/shared/components/ui/separator";
import { Text } from "@/shared/components/ui/text";

export type TSignInFormProps = {
  /** What the relay offers; null while its configuration loads (or when it can't be reached). */
  methods: { email: boolean; dev: boolean } | null;
  relayUrl: string;
  onRelayUrlChange: (url: string) => void;
  /** The address a link was already sent to (show the link step). */
  pendingEmail: string | null;
  /** The sign-in link this screen was opened with, if any. */
  initialLink: string;
  busy: boolean;
  error: string | null;
  onSendLink: (email: string) => void;
  onCompleteLink: (relayUrl: string, email: string, link: string) => void;
  onDevSignIn: (relayUrl: string, uid: string) => void;
};

/**
 * Sign in: email link (Firebase) and, on a dev relay, a dev user id. The relay field is where this
 * device and your computers meet; most people keep the default.
 */
export function SignInForm({
  methods,
  relayUrl,
  onRelayUrlChange,
  pendingEmail,
  initialLink,
  busy,
  error,
  onSendLink,
  onCompleteLink,
  onDevSignIn,
}: TSignInFormProps): React.JSX.Element {
  const { t } = useTranslation();
  const [email, setEmail] = useState(pendingEmail ?? "");
  const [link, setLink] = useState(initialLink);
  const [uid, setUid] = useState("");
  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Label nativeID="relay-url">{t("auth.relay")}</Label>
        <Input
          aria-labelledby="relay-url"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={relayUrl}
          onChangeText={onRelayUrlChange}
        />
      </View>
      {methods?.email === true ? (
        <View className="gap-3">
          <Label nativeID="email">{t("auth.email")}</Label>
          <Input
            aria-labelledby="email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChangeText={setEmail}
          />
          <Button
            variant={pendingEmail === null ? "default" : "outline"}
            disabled={busy || !email.includes("@")}
            onPress={() => {
              onSendLink(email.trim());
            }}
          >
            <Text>{pendingEmail === null ? t("auth.sendLink") : t("auth.resendLink")}</Text>
          </Button>
          {pendingEmail === null ? null : (
            <View className="gap-1.5">
              <Label nativeID="link">{t("auth.linkLabel")}</Label>
              <Input
                aria-labelledby="link"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t("auth.linkPlaceholder")}
                value={link}
                onChangeText={setLink}
              />
              <Button
                disabled={busy || link.trim().length === 0}
                onPress={() => {
                  onCompleteLink(relayUrl.trim(), email.trim(), link.trim());
                }}
              >
                <Text>{t("auth.signIn")}</Text>
              </Button>
            </View>
          )}
        </View>
      ) : null}
      {methods?.email === true && methods.dev ? <Separator /> : null}
      {methods?.dev === true ? (
        <View className="gap-3">
          <Label nativeID="dev-uid">{t("auth.devUid")}</Label>
          <Input
            aria-labelledby="dev-uid"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="me"
            value={uid}
            onChangeText={setUid}
          />
          <Button
            variant="secondary"
            disabled={busy || !/^[\w.@+-]{1,128}$/.test(uid.trim())}
            onPress={() => {
              onDevSignIn(relayUrl.trim(), uid.trim());
            }}
          >
            <Text>{t("auth.devSignIn")}</Text>
          </Button>
        </View>
      ) : null}
      {methods !== null && !methods.email && !methods.dev ? (
        <Text className="text-muted-foreground">{t("auth.notConfigured")}</Text>
      ) : null}
      {error === null ? null : <Text className="text-destructive">{error}</Text>}
    </View>
  );
}
