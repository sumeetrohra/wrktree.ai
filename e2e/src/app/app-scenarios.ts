import { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";
import { linkHost } from "../scenarios/relay-helpers.ts";

import { APP_DIST, type AppDriver } from "./app-driver.ts";
import {
  desktopWeb,
  desktopWebSignsIn,
  linkFromApp,
  newTaskFromApp,
  offlineFromApp,
  revokeApp,
  signInApp,
  twoHostsInApp,
  wakeLinkFromApp,
} from "./app-flows.ts";

/** A Phase 2 scenario: the app's web build in a phone-sized browser against the real stack. */
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

/** A second computer, `desktop`, on the same relay as `h`. Stopped by the caller. */
function secondHost(h: Harness): Promise<Harness> {
  return Harness.start(h.sink, { relayUrl: h.relayUrl, hostName: "desktop", watch: false });
}

export const appScenarios: TAppScenario[] = [
  {
    n: 14,
    title: "The app: sign in, link two computers, run a task, go offline, get woken, get removed",
    summary:
      "Sign-in → approve `agentdeck login` → one Work view across computers → task with a permission → airplane mode → push deep link → removal",
    covers: [
      "Phase 2c: sign in on the app; link computers by approving their code; no pairing",
      "Phase 2c: one Work view across computers with branch, agent, profile and model",
      "Phase 2: start a task and approve a permission from the phone; offline catch-up; content-free push",
    ],
    harness: { relay: true },
    async run(h, app) {
      await repoWithProfile(h);
      await signInApp(h, app);
      await linkFromApp(h, app, "laptop");
      const b = await secondHost(h);
      try {
        await twoHostsInApp(h, b, app);
        await newTaskFromApp(h, app, "laptop", "shop", "Write the notes");
        await offlineFromApp(h, app);
        await wakeLinkFromApp(h, app);
        await revokeApp(h, app);
      } finally {
        await b.stop();
      }
    },
  },
  {
    n: 15,
    title: "The desktop web UI: this computer, then every computer",
    summary:
      "`agentdeck open` hands the browser a one-time code; signing in adds the account's other computers",
    covers: [
      "Desktop web: the same app served by the daemon over the local transport",
      "Phase 2c: one machine both hosts and consumes: its web UI also reaches another computer",
    ],
    harness: { relay: true, webRoot: APP_DIST },
    async run(h, app) {
      await repoWithProfile(h);
      await desktopWeb(h, app);
      // Both computers join the account (approved from a phone), then the web UI signs in.
      const phone = new PhoneSim(h.relayUrl, "Pixel 9");
      await phone.signIn("me");
      await linkHost(h, phone);
      const b = await secondHost(h);
      try {
        b.makeRepo("api");
        await b.send("repo.add", { path: `${b.src}/api` });
        await linkHost(b, phone);
        await desktopWebSignsIn(h, app);
      } finally {
        await b.stop();
      }
    },
  },
];
