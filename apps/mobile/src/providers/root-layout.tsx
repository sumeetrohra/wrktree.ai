import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AppProviders } from "./app-providers";

/** The router's root layout: providers around a stack navigator. */
export function RootLayout(): React.JSX.Element {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
