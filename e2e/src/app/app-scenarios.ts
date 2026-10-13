import { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";
import { linkHost } from "../scenarios/relay-helpers.ts";

import { APP_DIST, type AppDriver } from "./app-driver.ts";
import {
  cloudHistoryInApp,
  desktopWeb,
  desktopWebSignsIn,
  handoffFromApp,
  limitFromApp,
  linkFromApp,
  newTaskFromApp,
  offlineFromApp,
  previewFromApp,
  revokeApp,
  shipFromApp,
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
  harness: { relay?: boolean; firebase?: boolean; webRoot?: string };
  /** Serve the app under this loopback name instead of 127.0.0.1 (see `AppDriver.start`). */
  appHost?: string;
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
  {
    n: 20,
    title: "The app: review the work, ask about a line, run it, ship it",
    summary:
      "Changes → diff → ask about a line; Files search and a 5,000-line file; Logs; commit, push, agent-drafted PR, merge",
    covers: [
      "Phase 3b: see what changed and read the code from the phone (colored, virtualized)",
      "Phase 3b: comment on a line → the agent gets the quoted code",
      "Phase 3b: run the repo's scripts and follow their logs; ship as a PR the agent drafted",
    ],
    harness: { relay: true },
    run: shipFromApp,
  },
  {
    n: 22,
    title: "The app: preview the running app, with hot reload",
    summary:
      "Preview tab → the dev server's page in a frame through the relay; the agent edits it and it reloads by itself",
    covers: [
      "Phase 3c: the worktree's app opens on the phone through the relay, no ports exposed",
      "Phase 3c: hot reload over the tunnel's WebSocket; phone, tablet and full widths",
    ],
    harness: { relay: true },
    appHost: "preview.localhost",
    run: previewFromApp,
  },
  {
    n: 24,
    title: "The app: a profile at its usage limit",
    summary:
      "The chat shows the limit and when it resets; a message waits in the queue and goes out at the reset; Settings shows usage",
    covers: [
      "Phase 4a: limit banner with the reset time; queued sends resume at the reset",
      "Phase 4a: per-profile usage in Settings (limit state, today's tokens)",
    ],
    harness: { relay: true },
    run: limitFromApp,
  },
  {
    n: 26,
    title: "The app: continue a limited chat on another profile",
    summary: "The limit banner offers another profile; a new chat in the same worktree picks up from a brief",
    covers: ["Phase 4b: hand-off from the limit banner, same worktree, brief without a model call"],
    harness: { relay: true },
    run: handoffFromApp,
  },
];

/** Phase 3a: the app reads an offline computer's chats from Firebase (needs the emulators). */
export const cloudAppScenarios: TAppScenario[] = [
  {
    n: 17,
    title: "The app: an offline computer's chats, from the cloud",
    summary: "The laptop syncs to Firestore, then shuts; Work and the chat still show everything, read-only",
    covers: [
      "Phase 3a: worktrees and chats from Firestore when their computer is offline",
      "Phase 3a: a deleted worktree's chats stay in the cloud",
    ],
    harness: { firebase: true },
    run: cloudHistoryInApp,
  },
];
