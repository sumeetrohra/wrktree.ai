import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { queryClient } from "@/lib/api";
import { initI18n } from "@/shared/i18n/i18n";

const i18n = initI18n();

/** Composition only: every provider the app needs, in one place. */
export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}
