import { startChatListSync, startChatStoreSync } from "@/modules/chats";
import { startCompareSync } from "@/modules/compare";
import { startPreviewSync } from "@/modules/preview";
import { startProcsSync } from "@/modules/procs";
import { startUsageSync } from "@/modules/profiles";
import { initSentry } from "@/modules/sentry";
import { startTerminalSync } from "@/modules/terminal";
import { startOverviewSync } from "@/modules/workspace";
import { startWorktreesSync } from "@/modules/worktrees";
import { RootLayout } from "@/providers";

// Routes load lazily, so the modules that follow daemon events start here, at app startup,
// before any connection can deliver anything. (S4: only a page composes modules.)
// Crash reporting first (a no-op without a DSN): it catches unhandled errors from here on.
initSentry();
startChatStoreSync();
startChatListSync();
startWorktreesSync();
startOverviewSync();
startProcsSync();
startPreviewSync();
startUsageSync();
startTerminalSync();
startCompareSync();

/** The app shell: providers, the connections, and every module's event sync. */
export function RootPage(): React.JSX.Element {
  return <RootLayout />;
}
