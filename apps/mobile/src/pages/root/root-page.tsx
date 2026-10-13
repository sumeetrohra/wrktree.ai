import { startChatListSync, startChatStoreSync } from "@/modules/chats";
import { startPreviewSync } from "@/modules/preview";
import { startProcsSync } from "@/modules/procs";
import { startOverviewSync } from "@/modules/workspace";
import { startWorktreesSync } from "@/modules/worktrees";
import { RootLayout } from "@/providers";

// Routes load lazily, so the modules that follow daemon events start here, at app startup,
// before any connection can deliver anything. (S4: only a page composes modules.)
startChatStoreSync();
startChatListSync();
startWorktreesSync();
startOverviewSync();
startProcsSync();
startPreviewSync();

/** The app shell: providers, the connections, and every module's event sync. */
export function RootPage(): React.JSX.Element {
  return <RootLayout />;
}
