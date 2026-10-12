import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView } from "react-native";

import { SignInForm, useFinishSignInMutation, useStartSignInMutation } from "@/modules/auth";
import { usePairMutation, usePairingStore } from "@/modules/pairing";
import { Text } from "@/shared/components/ui/text";

/** Step 2: sign in to the relay from the QR code, then pair with the computer. */
export function SignInPage(): React.JSX.Element {
  const { t } = useTranslation();
  const offer = usePairingStore((s) => s.offer);
  const start = useStartSignInMutation();
  const finish = useFinishSignInMutation();
  const pair = usePairMutation();
  if (!offer) return <Redirect href="/pair" />;
  const error = start.error ?? finish.error ?? pair.error;
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Text variant="h3">{t("auth.title")}</Text>
      <Text className="text-muted-foreground">
        {t("auth.intro", { relay: new URL(offer.relayUrl).host })}
      </Text>
      <SignInForm
        codeSent={start.isSuccess}
        busy={start.isPending || finish.isPending || pair.isPending}
        error={error ? t("auth.failed", { reason: error.message }) : null}
        onRequestCode={(email) => {
          start.mutate({ relayUrl: offer.relayUrl, email });
        }}
        onSubmitCode={(email, code) => {
          finish.mutate(
            { relayUrl: offer.relayUrl, email, code },
            {
              onSuccess: ({ session, deviceToken }) => {
                pair.mutate(
                  { offer, session, deviceToken },
                  {
                    onSuccess: () => {
                      router.replace("/confirm-code");
                    },
                  },
                );
              },
            },
          );
        }}
      />
    </ScrollView>
  );
}
