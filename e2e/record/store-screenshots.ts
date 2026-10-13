/**
 * `pnpm --filter @agentdeck/e2e store:screenshots`: store screenshots of the real app (its web
 * build) against a real daemon, relay and scripted agent, at App Store and Play sizes, into
 * apps/mobile/store/screenshots/<device>/. Needs `pnpm build` and the app's web export.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AppDriver } from "../src/app/app-driver.ts";
import { linkFromApp, signInApp } from "../src/app/app-flows.ts";
import { Harness, REPO_ROOT } from "../src/harness.ts";

const OUT = join(REPO_ROOT, "apps", "mobile", "store", "screenshots");

/** Store sizes: points × pixel ratio. */
const DEVICES = [
  { name: "iphone-6.9", viewport: { width: 440, height: 956 }, scale: 3 }, // 1320 × 2868
  { name: "ipad-13", viewport: { width: 1032, height: 1376 }, scale: 2 }, // 2064 × 2752
  { name: "android-phone", viewport: { width: 360, height: 640 }, scale: 3 }, // 1080 × 1920
] as const;

// The scripted agent stands in for Claude Code (registered under its id, dev mode only) and runs
// a showcase script per profile, so the prompts read like real ones.
const h = await Harness.start(undefined, { relay: true, env: { AGENTDECK_DEV_AGENT_ID: "claude" } });
try {
  h.makeRepo("shop", {
    scripts: { dev: "node -e \"require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT)\"" },
  });
  const repo = await h.send("repo.add", { path: `${h.src}/shop` });
  const work = await h.addProfile("Work", "claude");
  const personal = await h.addProfile("Personal", "claude");
  for (const [profileId, script] of [
    [work, "showcase-notes"],
    [personal, "showcase-login"],
  ] as const) {
    const { env } = await h.send("profile.loginCommand", { profileId });
    writeFileSync(join(env["FAKE_AGENT_HOME"] ?? "", "fake-default-script"), script);
  }

  let first: AppDriver | null = await AppDriver.start({
    viewport: DEVICES[0].viewport,
    scale: DEVICES[0].scale,
  });
  await signInApp(h, first);
  await linkFromApp(h, first, "laptop");

  // A finished task: the agent wrote NOTES.md (approved), so there's a chat and a diff.
  let since = h.mark();
  const wt = await h.send("worktree.create", {
    repoId: repo.id,
    branch: "release-notes",
    title: "Release notes",
  });
  await h.waitReady(wt.id, since);
  since = h.mark();
  const done = await h.send("chat.create", {
    worktreeId: wt.id,
    agent: "claude",
    profileId: work,
    title: "Release notes for 2.0",
  });
  await h.waitStatus(done.id, "idle", since);
  since = h.mark();
  await h.send("chat.send", {
    chatId: done.id,
    text: "Write the release notes for 2.0 into NOTES.md, for users rather than as a commit log.",
  });
  const req = await h.waitFor(
    (e) => e.type === "permission.requested" && e.chatId === done.id,
    "permission",
    { since },
  );
  if (req.type !== "permission.requested") throw new Error("no permission request");
  await h.send("permission.respond", {
    chatId: done.id,
    requestId: req.request.requestId,
    decision: "allow_once",
  });
  await h.waitSettled(done.id);

  // A task waiting for approval: the permission sheet.
  since = h.mark();
  const wt2 = await h.send("worktree.create", {
    repoId: repo.id,
    branch: "fix-login",
    title: "Fix the login redirect",
  });
  await h.waitReady(wt2.id, since);
  since = h.mark();
  const waiting = await h.send("chat.create", {
    worktreeId: wt2.id,
    agent: "claude",
    profileId: personal,
    title: "Login bug",
  });
  await h.waitStatus(waiting.id, "idle", since);
  since = h.mark();
  await h.send("chat.send", {
    chatId: waiting.id,
    text: "After signing in, everyone lands on the home page. Send people back to the page they were on.",
  });
  await h.waitFor((e) => e.type === "permission.requested" && e.chatId === waiting.id, "permission", {
    since,
  });
  const hostId = await h.deviceId();

  const SCREENS = [
    { file: "1-work", path: "/", ready: "Fix the login redirect" },
    { file: "2-approve", path: `/h/${hostId}/chat/${waiting.id}`, ready: "Allow once" },
    { file: "3-chat", path: `/h/${hostId}/chat/${done.id}`, ready: "Want me to open a pull request?" },
    { file: "4-diff", path: `/h/${hostId}/wt/${wt.id}/diff/NOTES.md`, ready: "Offline sync." },
    { file: "5-usage", path: "/settings", ready: "Shared with every profile" },
  ];

  for (const [i, d] of DEVICES.entries()) {
    const app = first ?? (await AppDriver.start({ viewport: d.viewport, scale: d.scale }));
    first = null;
    if (i > 0) {
      await signInApp(h, app);
      await app.goto("/hosts");
      await app.page.getByText("laptop", { exact: true }).first().waitFor({ timeout: 30_000 });
    }
    const dir = join(OUT, d.name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const s of SCREENS) {
      await app.goto(s.path);
      await app.page
        .getByText(s.ready, { exact: false })
        .locator("visible=true")
        .first()
        .waitFor({ timeout: 30_000 });
      await app.page.waitForTimeout(800); // fonts and highlighting settle
      await app.page.screenshot({ path: join(dir, `${s.file}.png`) });
      process.stdout.write(`${d.name}/${s.file}.png\n`);
    }
    await app.stop();
  }
} finally {
  await h.stop();
}
