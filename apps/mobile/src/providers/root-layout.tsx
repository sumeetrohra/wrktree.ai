import "../global.css";

import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { bootConnections } from "@/lib/api";
import { onNotificationTap } from "@/lib/notifications";

import { AppProviders } from "./app-providers";

// Once, when the app starts: connect to this computer's daemon (desktop web) and to every host on
// the account, and send a tapped push to the wake screen, which opens the chat that needs the user.
bootConnections();
onNotificationTap(() => {
  router.push("/wake");
});

/** The router's root layout: providers around a stack navigator. */
export function RootLayout(): React.JSX.Element {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerTitle: "", headerBackTitle: "", headerShadowVisible: false }} />
    </AppProviders>
  );
}
