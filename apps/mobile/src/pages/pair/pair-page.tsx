import { Redirect, router, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { Platform, ScrollView } from "react-native";

import { linkToOffer, useConnectionStore, type TPairingOffer } from "@/lib/api";
import { QrScanner } from "@/lib/camera";
import { PairLinkForm, usePairingStore } from "@/modules/pairing";
import { Text } from "@/shared/components/ui/text";

/** Step 1 of onboarding: scan the QR code `agentdeck pair` shows, or paste its link. */
export function PairPage(): React.JSX.Element {
  const { t } = useTranslation();
  const local = useConnectionStore((s) => s.local);
  const setOffer = usePairingStore((s) => s.setOffer);
  if (local) return <Redirect href="/" />;
  const accept = (offer: TPairingOffer): void => {
    setOffer(offer);
    router.push("/sign-in");
  };
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" className="bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <Text variant="h3">{t("pairing.title")}</Text>
      <Text className="text-muted-foreground">{t("pairing.intro")}</Text>
      {Platform.OS === "web" ? null : (
        <QrScanner
          onScanned={(data) => {
            const offer = linkToOffer(data);
            if (offer) accept(offer);
          }}
        />
      )}
      <PairLinkForm onOffer={accept} />
    </ScrollView>
  );
}
