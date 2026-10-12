import type { Harness } from "../harness.ts";

import { APP_DIST, type AppDriver } from "./app-driver.ts";
import {
  desktopWeb,
  newTaskFromApp,
  offlineFromApp,
  pairApp,
  revokeApp,
  wakeLinkFromApp,
} from "./app-flows.ts";

/** A Phase 2b scenario: the app's web build in a phone-sized browser against the real stack. */
export type TAppScenario = {
  n: number;
  title: string;
  summary: string;
  covers: string[];
  harness: { relay?: boolean; webRoot?: string };
  run(h: Harness, app: AppDriver): Promise<void>;
};

async function repoWithProfile(h: Harness): Promise<void> {
  h.makeRepo("shop");
  await h.send("repo.add", { path: `${h.src}/shop` });
  await h.addProfile("Personal");
}

export const appScenarios: TAppScenario[] = [
  {
    n: 13,
    title: "The app: pair, run a task, go offline, get woken, get revoked",
    summary:
      "QR link → sign-in → matching codes; a task with a permission; airplane mode; push deep link; revocation",
    covers: [
      "Phase 2: pair a phone through the relay; start a task and approve a permission from the phone",
      "Phase 2: offline phone catches up in order; a content-free push opens the chat that needs the user",
    ],
    harness: { relay: true },
    async run(h, app) {
      await repoWithProfile(h);
      await pairApp(h, app);
      await newTaskFromApp(h, app, "shop", "Write the notes");
      await offlineFromApp(h, app);
      await wakeLinkFromApp(h, app);
      await revokeApp(h, app);
    },
  },
  {
    n: 14,
    title: "The desktop web UI, served by the daemon",
    summary:
      "`agentdeck open` hands the browser a one-time code; the page never holds a long-lived secret in a URL",
    covers: ["Desktop web: the same app served by the daemon over the local transport"],
    harness: { webRoot: APP_DIST },
    async run(h, app) {
      await repoWithProfile(h);
      await desktopWeb(h, app);
    },
  },
];
