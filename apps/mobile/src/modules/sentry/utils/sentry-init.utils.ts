import * as Sentry from "@sentry/react-native";
import { z } from "zod";

import { scrubBreadcrumb, scrubEvent } from "./sentry.utils";

/**
 * Crash reporting, off unless the build sets `EXPO_PUBLIC_SENTRY_DSN`; it then reports crashes and
 * unhandled errors on its own. No personal data, no
 * performance tracing; breadcrumbs and events are scrubbed of text (SEC8).
 */
export function initSentry(): void {
  const dsn = z.url().safeParse(process.env.EXPO_PUBLIC_SENTRY_DSN);
  if (!dsn.success) return;
  Sentry.init({
    dsn: dsn.data,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}
