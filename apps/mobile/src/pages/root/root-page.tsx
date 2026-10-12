import { startChatListSync, startChatStoreSync } from "@/modules/chats";
import { startDevicesSync } from "@/modules/devices";
import { startWorktreesSync } from "@/modules/worktrees";
import { RootLayout } from "@/providers";

// Routes load lazily, so the modules that follow daemon events start here, at app startup,
// before the connection can deliver anything. (S4: only a page composes modules.)
startChatStoreSync();
startChatListSync();
startWorktreesSync();
startDevicesSync();

/** The app shell: providers, the connection, and every module's event sync. */
export function RootPage(): React.JSX.Element {
  return <RootLayout />;
}
