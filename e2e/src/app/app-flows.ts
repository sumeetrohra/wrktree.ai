import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import type { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";
import { eventually } from "../scenarios/relay-helpers.ts";
import { PREVIEW_DEV_SERVER, PREVIEW_PAGE } from "../scenarios/relay-preview.scenario.ts";

import type { AppDriver } from "./app-driver.ts";

/**
 * The visible element with exactly this text. The router keeps earlier screens mounted (hidden),
 * so a plain text match can find a copy on a screen underneath.
 */
const shown = (page: AppDriver["page"], text: string) =>
  page.getByText(text, { exact: true }).locator("visible=true").first();

/** App: open it signed out, land on sign-in, sign in with the relay's dev issuer as `uid`. */
export async function signInApp(h: Harness, app: AppDriver, uid = "me"): Promise<void> {
  const { page } = app;
  h.step("App: open it; a device with no account lands on sign-in");
  await app.goto("/");
  await page.getByLabel("Relay").waitFor({ timeout: 30_000 });
  h.step(`App: sign in (dev issuer standing in for Firebase) as "${uid}"`);
  await page.getByLabel("Relay").fill(h.relayUrl);
  await page.getByPlaceholder("me").fill(uid);
  await page.getByText("Dev sign-in").click();
  await page.getByText("Work", { exact: true }).waitFor({ timeout: 30_000 });
}

/**
 * Desktop: `agentdeck login` as the user the app signed in as. The computer joins the account and
 * the app picks it up from the relay's presence.
 */
export async function linkFromApp(h: Harness, app: AppDriver, name: string, uid = "me"): Promise<void> {
  h.step(`Desktop "${name}": \`agentdeck login\` (signs in as the same user)`);
  const { code, out } = await h.cli(["login", "--dev", uid]);
  assert.equal(code, 0, out);
  await h.waitRelayConnected();
  h.step(`App: "${name}" shows up under Computers`);
  await app.goto("/hosts");
  await shown(app.page, name).waitFor({ timeout: 30_000 });
}

/** App: New task on a repo → the chat opens and streams; approve the permission; the turn ends. */
export async function newTaskFromApp(
  h: Harness,
  app: AppDriver,
  host: string,
  repo: string,
  title: string,
): Promise<void> {
  const { page } = app;
  h.step(`App: New task on "${host}", repo "${repo}"`);
  await app.goto("/");
  await page.getByText("New task", { exact: true }).first().click();
  await shown(page, host).click();
  await shown(page, repo).click();
  await page.getByPlaceholder("Fix the login redirect").fill(title);
  await page.getByPlaceholder("Describe the task…").fill("#script:golden file=NOTES.md");
  await page.getByText("Start task").click();

  h.step("App: the chat streams; the agent asks for permission");
  await page.getByText("Allow once").waitFor({ timeout: 30_000 });
  await h.check("the permission sheet shows what the agent wants to do", async () => {
    assert.ok(await page.getByText("Write NOTES.md").first().isVisible());
  });

  h.step("App: Allow once; the turn finishes");
  await page.getByText("Allow once").click();
  await page.getByText("Done.").waitFor({ timeout: 30_000 });
  await h.check("the sheet is gone and the chat is idle", async () => {
    await page.getByText("Allow once").waitFor({ state: "detached" });
    // The idle status follows the turn's last text (and its usage record) by a moment.
    await shown(page, "idle").waitFor({ timeout: 10_000 });
  });
}

/** The id the app registered with (a browser joins the account as a `web` device). */
async function appDeviceId(h: Harness): Promise<string> {
  const devices = await h.send("device.list", {});
  const web = devices.find((d) => d.kind === "web");
  if (!web) throw new Error("the app isn't on the account");
  return web.id;
}

/** The chat the app created last, as the desktop saw it. */
function lastChatId(h: Harness): string {
  for (let i = h.events.length - 1; i >= 0; i--) {
    const e = h.events[i]!.event;
    if (e.type === "chat.status") return e.chatId;
  }
  throw new Error("no chat yet");
}

/** Airplane mode while the agent works: a content-free push, then a full catch-up on reconnect. */
export async function offlineFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page, context } = app;
  const phoneId = await appDeviceId(h);
  const chatId = lastChatId(h);

  // The web build gets no Expo push token; register a stand-in with the app's own device
  // token, exactly as the native app does after signing in.
  const deviceToken = await page.evaluate(() => globalThis.localStorage.getItem("secure.relay.deviceToken"));
  await fetch(`${h.relayUrl}/v1/push/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken ?? ""}` },
    body: JSON.stringify({ expoPushToken: "ExponentPushToken[app-e2e]" }),
  });

  h.step("App: airplane mode");
  await context.setOffline(true);
  await page
    .getByText(/· (offline|connecting)/)
    .last()
    .waitFor({ timeout: 20_000 });

  h.step("Desktop: the agent works and asks for permission while the phone is away");
  const since = h.mark();
  await h.send("chat.send", { chatId, text: "#script:golden file=OFFLINE.md" });
  await h.waitFor((e) => e.type === "permission.requested" && e.chatId === chatId, "permission", { since });
  await h.pause(500);
  const res = await fetch(`${h.relayUrl}/v1/dev/pushes`);
  const { pushes } = (await res.json()) as { pushes: { deviceId: string; body: string }[] };
  await h.check("one push went to the phone, with no content in it", () => {
    const mine = pushes.filter((p) => p.deviceId === phoneId);
    assert.equal(mine.length, 1);
    assert.ok(!mine[0]!.body.includes("OFFLINE"));
  });

  h.step("App: back online; it catches up and shows the request");
  await context.setOffline(false);
  await page.getByText("Allow once").waitFor({ timeout: 30_000 });
  await page.getByText("Allow once").click();
  await h.waitSettled(chatId);
  await page.getByText("Wrote OFFLINE.md.").waitFor({ timeout: 30_000 });
  await h.check("the app shows both turns, in order", async () => {
    const body = await page.locator("body").innerText();
    assert.ok(body.indexOf("Wrote NOTES.md.") < body.indexOf("Wrote OFFLINE.md."));
  });
}

/** Where a tapped push lands: the chat with the newest pending permission. */
export async function wakeLinkFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  const chatId = lastChatId(h);
  h.step("App: on the home screen; the agent asks for permission again");
  await app.goto("/");
  await page.getByText("Work", { exact: true }).waitFor();
  const since = h.mark();
  await h.send("chat.send", { chatId, text: "#script:edit-twice file=wake.txt" });
  await h.waitFor((e) => e.type === "permission.requested" && e.chatId === chatId, "permission", { since });

  h.step("App: the push opens /wake, which lands on that chat");
  await app.goto("/wake");
  await page.getByText("Allow once").waitFor({ timeout: 30_000 });
  await h.check("the deep link opened the chat that needs the user", async () => {
    assert.ok(await page.getByText("Edit wake.txt").first().isVisible());
  });
  await page.getByText("Allow once").click();
  await h.waitSettled(chatId);
}

/** Two computers on the account: the Work view shows each one's repos, branches and chats. */
export async function twoHostsInApp(h: Harness, b: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step('Desktop "desktop": a repo, a profile and a chat with a chosen model');
  const repoPath = b.makeRepo("api");
  const repo = await b.send("repo.add", { path: repoPath });
  const profileId = await b.addProfile("Work");
  const since = b.mark();
  const wt = await b.send("worktree.create", { repoId: repo.id, branch: "fix-login", title: "Fix login" });
  await b.waitReady(wt.id, since);
  await b.send("chat.create", {
    worktreeId: wt.id,
    agent: "fake",
    profileId,
    model: "fake-large",
    title: "Login bug",
  });
  await linkFromApp(b, app, "desktop");

  h.step("App: Work lists both computers, each with its repos, branches and chats");
  await app.goto("/");
  await shown(page, "api").waitFor({ timeout: 30_000 });
  await shown(page, "shop").waitFor({ timeout: 30_000 });
  await h.check("both computers' repos and branches are on one screen", async () => {
    assert.ok(await page.getByText("fix-login · Fix login").isVisible());
    assert.ok(await page.getByText("Login bug").isVisible());
  });
  await h.check("each chat shows its agent, profile and model", async () => {
    assert.ok(await page.getByText("fake · Work · fake-large").isVisible());
  });

  h.step('App: filter to "desktop"');
  await shown(page, "desktop").click();
  await h.check("only that computer's work is shown", async () => {
    await page.getByText("shop", { exact: true }).locator("visible=true").waitFor({ state: "detached" });
    assert.ok(await shown(page, "api").isVisible());
  });
  await shown(page, "All computers").click();
}

/** `agentdeck devices revoke` on a computer: the app is cut off and says so. */
export async function revokeApp(h: Harness, app: AppDriver): Promise<void> {
  const deviceId = await appDeviceId(h);
  await app.goto("/");
  await app.page.getByText("Work", { exact: true }).waitFor();
  h.step("Desktop: `agentdeck devices revoke` (removes the app from the account)");
  const { code, out } = await h.cli(["devices", "revoke", deviceId]);
  assert.equal(code, 0, out);
  await app.page.getByText("This device was removed").waitFor({ timeout: 30_000 });
  await h.check("the app shows it was removed and offers to sign in again", async () => {
    assert.ok(await app.page.getByText("Sign in again to keep using it.", { exact: false }).isVisible());
  });
}

/**
 * The desktop web UI served by the daemon itself: `agentdeck open`, no sign-in for this computer;
 * signing in adds the account's other computers.
 */
export async function desktopWeb(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: `agentdeck open` (a one-time link to the daemon's own web UI)");
  const { stdout } = await h.cli(["open", "--print"]);
  const url = stdout.trim();
  await h.check("the link carries a one-time code, not the token", () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}$/);
  });
  await page.goto(url);
  await page.getByText("shop", { exact: true }).waitFor({ timeout: 30_000 });
  await h.check("the page lists this computer's repos over the local connection, signed out", async () => {
    assert.ok(await page.getByText("This computer", { exact: true }).first().isVisible());
    assert.ok(await page.getByText("Sign in to see your other computers").isVisible());
  });

  h.step("The same link in a fresh browser is refused (single use)");
  const other = await app.browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(url);
  await h.check("a used code opens nothing: the second browser lands on sign-in", async () => {
    await stranger.getByLabel("Relay").waitFor({ timeout: 30_000 });
  });
  await other.close();
}

/** This computer's web UI signs in and also shows `desktop`, without listing itself twice. */
export async function desktopWebSignsIn(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop web: Sign in to see your other computers");
  await page.getByText("Sign in to see your other computers").click();
  await page.getByPlaceholder("me").fill("me");
  await h.check("the relay comes from this computer's daemon", async () => {
    assert.equal(await page.getByLabel("Relay").inputValue(), h.relayUrl);
  });
  await page.getByText("Dev sign-in").click();
  await shown(page, "api").waitFor({ timeout: 30_000 });
  await h.check("this computer (local) and desktop (through the relay), each once", async () => {
    assert.ok(await shown(page, "shop").isVisible());
    assert.equal(await page.getByText("laptop", { exact: true }).locator("visible=true").count(), 0);
    assert.equal(await page.getByText("api", { exact: true }).locator("visible=true").count(), 1);
  });
}

/**
 * Cloud history: the laptop's chats reach Firestore, the laptop goes away, and the app still
 * lists its branches and chats and opens a chat read-only from the cloud.
 */
export async function cloudHistoryInApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: two worktrees with a chat each; one turn in the first");
  const repoPath = h.makeRepo("shop");
  const repo = await h.send("repo.add", { path: repoPath });
  const profileId = await h.addProfile("Personal");
  const since = h.mark();
  const keep = await h.send("worktree.create", { repoId: repo.id, branch: "fix-login", title: "Fix login" });
  const gone = await h.send("worktree.create", { repoId: repo.id, branch: "old-idea", title: "Old idea" });
  await h.waitReady(keep.id, since);
  await h.waitReady(gone.id, since);
  const chat = await h.send("chat.create", {
    worktreeId: keep.id,
    agent: "fake",
    profileId,
    title: "Login bug",
  });
  const scratch = await h.send("chat.create", {
    worktreeId: gone.id,
    agent: "fake",
    profileId,
    title: "Scratch",
  });
  const turn = h.mark();
  await h.send("chat.send", { chatId: chat.id, text: "Why does login redirect twice?" });
  await h.waitStatus(chat.id, "idle", turn);

  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");

  // The first sync copies up what exists at sign-in; wait for it before deleting anything.
  const phone = new PhoneSim(h.relayUrl, "Checker");
  const { db, uid } = await phone.signInFirebase("me");
  const hostId = await h.deviceId();
  await eventually(
    "the backfilled chats in Firestore",
    () => db.list(`users/${uid}/chats`),
    (docs) => [chat.id, scratch.id].every((id) => docs.some((d) => d.data["chatId"] === id)),
  );

  h.step("Desktop: delete the second worktree; wait for the cloud to have it all");
  await h.send("worktree.delete", { worktreeId: gone.id });
  await eventually(
    "the deleted worktree in Firestore",
    () => db.get(`users/${uid}/worktrees/${hostId}__${gone.id}`),
    (d) => typeof d?.data["deletedAt"] === "number",
  );
  await eventually(
    "the agent's reply in Firestore",
    () => db.list(`users/${uid}/chats/${chat.id}/items`),
    (docs) => docs.some((d) => d.data["text"] === "You said: Why does login redirect twice?"),
  );

  h.step("Desktop: shut the laptop (kill -9)");
  await h.stopWatcher();
  await h.killDaemon();

  h.step("App: Work still lists the laptop's branches and chats, from the cloud");
  await app.goto("/");
  await shown(page, "From cloud history (this computer is offline)").waitFor({ timeout: 60_000 });
  await h.check("both branches and both chats are listed; the deleted worktree is marked", async () => {
    await shown(page, "Login bug").waitFor({ timeout: 30_000 });
    await shown(page, "Scratch").waitFor({ timeout: 10_000 });
    await shown(page, "old-idea · Old idea (worktree deleted)").waitFor({ timeout: 10_000 });
  });

  h.step("App: open the chat; it reads from the cloud, read-only");
  await shown(page, "Login bug").click();
  await shown(page, "You said: Why does login redirect twice?").waitFor({ timeout: 30_000 });
  await h.check("the whole turn is there, marked read-only", async () => {
    await shown(page, "Why does login redirect twice?").waitFor({ timeout: 10_000 });
    await page
      .getByText("History from the cloud", { exact: false })
      .locator("visible=true")
      .first()
      .waitFor();
  });
  await h.check("there is no composer", async () => {
    assert.equal(
      await page
        .getByPlaceholder(/message|ask/i)
        .locator("visible=true")
        .count(),
      0,
    );
  });
}

/** A tiny dev server for the Logs tab: prints, then serves on $PORT. */
const DEV_SERVER = `const http = require("node:http");
console.log("starting the dev server");
http
  .createServer((req, res) => res.end("ok"))
  .listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening on " + process.env.PORT));
`;

/**
 * Phase 3b in the app: Changes → a diff → select a line → ask the agent; Files search and a
 * 5,000-line file; Logs start/stop; Ship: commit, push, agent-drafted PR, merge.
 */
export async function shipFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: a repo with a GitHub-style origin, a dev script and a 5,000-line file");
  const big = Array.from(
    { length: 5000 },
    (_, i) => `export const line${String(i + 1)} = ${String(i + 1)};`,
  ).join("\n");
  const repoPath = h.makeRepo(
    "shop",
    { scripts: { dev: "node serve.cjs" } },
    { origin: true, files: { "serve.cjs": DEV_SERVER, "big.ts": `${big}\n` } },
  );
  const repo = await h.send("repo.add", { path: repoPath });
  const profileId = await h.addProfile("Personal");
  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");

  h.step("Desktop: the agent writes NOTES.md in a new worktree (approved on the desktop)");
  let since = h.mark();
  const wt = await h.send("worktree.create", { repoId: repo.id, branch: "notes", title: "Notes" });
  await h.waitReady(wt.id, since);
  const chat = await h.send("chat.create", {
    worktreeId: wt.id,
    agent: "fake",
    profileId,
    title: "Release notes",
  });
  await h.waitStatus(chat.id, "idle", since);
  since = h.mark();
  await h.send("chat.send", { chatId: chat.id, text: "#script:golden file=NOTES.md" });
  const req = await h.waitFor(
    (e) => e.type === "permission.requested" && e.chatId === chat.id,
    "permission",
    {
      since,
    },
  );
  assert.ok(req.type === "permission.requested");
  await h.send("permission.respond", {
    chatId: chat.id,
    requestId: req.request.requestId,
    decision: "allow_once",
  });
  await h.waitSettled(chat.id);

  h.step("App: Work → the branch → Changes → NOTES.md");
  await app.goto("/");
  await page.getByRole("link", { name: "notes · Notes" }).click({ timeout: 30_000 });
  await shown(page, "Changes").click();
  await shown(page, "NOTES.md").click();
  await page
    .getByText("Written by the fake agent.", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });
  await h.check("the diff shows the new lines, numbered", async () => {
    assert.ok(
      await page.getByText("Line three.", { exact: false }).locator("visible=true").first().isVisible(),
    );
  });

  h.step("App: tap line 3, “Ask the agent about this”, send a question");
  await page
    .getByText("Written by the fake agent.", { exact: false })
    .locator("visible=true")
    .first()
    .click();
  await shown(page, "Ask the agent about this").click();
  await page
    .getByText("With NOTES.md:3", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });
  await page.getByPlaceholder("Message the agent…").fill("What does this line say?");
  await page.getByLabel("Send", { exact: true }).click();
  await page
    .getByText("Quoted NOTES.md:3", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });
  await h.check("the agent got the quoted line with the question", async () => {
    await page
      .getByText("You said: From `NOTES.md` line 3: ``` Written by the fake agent.", { exact: false })
      .locator("visible=true")
      .first()
      .waitFor({
        timeout: 30_000,
      });
  });

  h.step("App: Files → search “login” → open the match");
  await page.goBack();
  await page.goBack();
  await shown(page, "Files").click();
  await page.getByPlaceholder("Search file contents…").fill("login");
  await page.getByPlaceholder("Search file contents…").press("Enter");
  await shown(page, "src/app.ts:1").click();
  await page
    .getByText("export function login(user: string) {", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });

  h.step("App: a 5,000-line file opened at line 4,000");
  const hostId = await h.deviceId();
  await app.goto(`/h/${hostId}/wt/${wt.id}/files/big.ts?line=4000`);
  await page
    .getByText("export const line4000 = 4000;", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });
  await h.check("only a window of the file is on the page", async () => {
    assert.equal(await page.getByText("export const line1 = 1;", { exact: false }).count(), 0);
    assert.ok((await page.getByText(/export const line\d+ =/).count()) < 1000);
  });

  h.step("App: Logs → start `dev`, watch it, stop it");
  await app.goto(`/h/${hostId}/wt/${wt.id}/logs`);
  await shown(page, "Start").click();
  await page
    .getByText("listening on", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });
  await shown(page, "Stop").click();
  await shown(page, "stopped").waitFor({ timeout: 30_000 });

  h.step("App: Ship → commit, push, draft the PR with the agent, create it, merge it");
  await shown(page, "Ship").click();
  await page.getByPlaceholder("Commit message").fill("Add release notes");
  await shown(page, "Commit all changes").click();
  await shown(page, "Push").click();
  await shown(page, "Draft with the agent").waitFor({ timeout: 30_000 });
  await shown(page, "Draft with the agent").click();
  await h.check("the agent's draft fills the title", async () => {
    await page
      .getByPlaceholder("PR title")
      .and(page.locator('[value="Update the notes"]'))
      .waitFor({ timeout: 30_000 });
  });
  await shown(page, "Create pull request").click();
  await shown(page, "Pull request #1").waitFor({ timeout: 30_000 });
  await shown(page, "Squash and merge").click();
  await shown(page, "merged").waitFor({ timeout: 30_000 });
  await h.check("origin's main has the notes", () => {
    const notes = execFileSync("git", ["show", "main:NOTES.md"], { cwd: h.origin("shop"), encoding: "utf8" });
    assert.match(notes, /Written by the fake agent/);
  });
}

/**
 * Phase 3c in the app: the Preview tab shows the worktree's dev server through the relay; an agent
 * edit hot-reloads it; the width toggle and reload work; stop ends it.
 */
export async function previewFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: a repo whose config names a preview script (a dev server with hot reload)");
  const repoPath = h.makeRepo(
    "web",
    { scripts: { dev: "node serve.cjs" }, preview: { script: "dev" } },
    { files: { "serve.cjs": PREVIEW_DEV_SERVER, "index.html": PREVIEW_PAGE } },
  );
  const repo = await h.send("repo.add", { path: repoPath });
  const profileId = await h.addProfile("Personal");
  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");
  let since = h.mark();
  const wt = await h.send("worktree.create", { repoId: repo.id, branch: "landing", title: "Landing" });
  await h.waitReady(wt.id, since);

  h.step("App: the worktree's Preview tab → Start preview");
  const hostId = await h.deviceId();
  await app.goto(`/h/${hostId}/wt/${wt.id}/preview`);
  await shown(page, "Start preview").click();
  const frame = page.frameLocator('iframe[title="Preview of the worktree\'s app"]');
  await frame.getByText("version one").waitFor({ timeout: 60_000 });
  await h.check("the dev server's page, inside the app, through the relay", async () => {
    const src = await page.locator("iframe").first().getAttribute("src");
    assert.match(src ?? "", /^http:\/\/[0-9a-z]{58}\.preview\.localhost:\d+\//);
    await shown(page, "Live").waitFor({ timeout: 30_000 });
  });

  h.step("Desktop: the agent edits the page (approved on the desktop)");
  since = h.mark();
  const chat = await h.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId, title: "Copy" });
  await h.waitStatus(chat.id, "idle", since);
  since = h.mark();
  await h.send("chat.send", {
    chatId: chat.id,
    text: "#script:edit-twice file=index.html content=<h1>version-two</h1>",
  });
  const req = await h.waitFor(
    (e) => e.type === "permission.requested" && e.chatId === chat.id,
    "permission",
    {
      since,
    },
  );
  assert.ok(req.type === "permission.requested");
  await h.send("permission.respond", {
    chatId: chat.id,
    requestId: req.request.requestId,
    decision: "allow_once",
  });
  await h.check("the preview reloads by itself with the new page", async () => {
    await frame.getByText("version-two").waitFor({ timeout: 30_000 });
  });

  h.step("App: phone, tablet and full widths (on a wider window), then Reload");
  await page.setViewportSize({ width: 1100, height: 844 });
  const width = async (): Promise<number> => (await page.locator("iframe").first().boundingBox())?.width ?? 0;
  await shown(page, "Phone").click();
  await h.check("phone width", async () => {
    await eventually("390px", width, (w) => Math.round(w) === 390);
  });
  await shown(page, "Tablet").click();
  await h.check("tablet width", async () => {
    await eventually("820px", width, (w) => Math.round(w) === 820);
  });
  await shown(page, "Full").click();
  await h.check("full width", async () => {
    await eventually("the window", width, (w) => w > 1000);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await shown(page, "Reload").click();
  await h.check("reloads with its cookie (the one-time key is spent)", async () => {
    await frame.getByText("version-two").waitFor({ timeout: 30_000 });
    const src = await page.locator("iframe").first().getAttribute("src");
    assert.ok(!(src ?? "").includes("k="));
  });

  h.step("App: Stop");
  await shown(page, "Stop").click();
  await shown(page, "Start preview").waitFor({ timeout: 30_000 });
}

/**
 * Phase 4a in the app: a chat whose profile hits its limit shows the banner with the reset time;
 * a message typed meanwhile is queued and goes out at the reset; Settings shows each profile's
 * limit state and today's tokens.
 */
export async function limitFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: a repo and a profile");
  h.makeRepo("shop");
  const repo = await h.send("repo.add", { path: `${h.src}/shop` });
  const profileId = await h.addProfile("Personal");
  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");
  let since = h.mark();
  const wt = await h.send("worktree.create", { repoId: repo.id, branch: "limits", title: "Limits" });
  await h.waitReady(wt.id, since);
  since = h.mark();
  const chat = await h.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId, title: "Big job" });
  await h.waitStatus(chat.id, "idle", since);

  h.step("App: open the chat; the agent hits the profile's limit (resets in 8s)");
  const hostId = await h.deviceId();
  await app.goto(`/h/${hostId}/chat/${chat.id}`);
  await page.getByPlaceholder("Message the agent…").fill("#script:limit resetInMs=8000");
  await page.getByLabel("Send", { exact: true }).click();
  await shown(page, "This profile hit its usage limit").waitFor({ timeout: 30_000 });
  await h.check("the banner says when it resets", async () => {
    await page
      .getByText(/It resets in a few seconds|It resets in a minute/)
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 10_000 });
  });

  h.step("App: a message typed while limited is queued");
  await page.getByPlaceholder("Message the agent…").fill("pick it up after the reset");
  await page.getByLabel("Send", { exact: true }).click();
  await page
    .getByText("1 queued", { exact: false })
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });

  h.step("App: Settings shows the profile at its limit");
  await app.goto("/settings");
  await page
    .getByText(/At its limit · resets/)
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 30_000 });

  h.step("At the reset the queued message goes out");
  await h.waitText(chat.id, "pick it up after the reset", since, 30_000);
  await h.check("Settings shows the profile available, with today's tokens", async () => {
    await shown(page, "Available").waitFor({ timeout: 30_000 });
    await page
      .getByText(/Today: [\d,]+ in · [\d,]+ out/)
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 30_000 });
  });
  await app.goto(`/h/${hostId}/chat/${chat.id}`);
  await h.check("the banner is gone", async () => {
    await page
      .getByText("You said: pick it up after the reset", { exact: false })
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 30_000 });
    assert.equal(await shown(page, "This profile hit its usage limit").count(), 0);
  });
}

/**
 * Phase 4b in the app: the limit banner offers "Continue on another profile"; picking one opens a
 * new chat in the same worktree that starts from a hand-off brief.
 */
export async function handoffFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: a repo and two profiles");
  h.makeRepo("shop");
  const repo = await h.send("repo.add", { path: `${h.src}/shop` });
  const work = await h.addProfile("Work");
  await h.addProfile("Personal");
  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");
  let since = h.mark();
  const wt = await h.send("worktree.create", { repoId: repo.id, branch: "notes", title: "Notes" });
  await h.waitReady(wt.id, since);
  since = h.mark();
  const chat = await h.send("chat.create", {
    worktreeId: wt.id,
    agent: "fake",
    profileId: work,
    title: "Notes",
  });
  await h.waitStatus(chat.id, "idle", since);

  h.step("App: the agent on Work hits its limit");
  const hostId = await h.deviceId();
  await app.goto(`/h/${hostId}/chat/${chat.id}`);
  await page
    .getByPlaceholder("Message the agent…")
    .fill("Write the changelog #script:limit resetInMs=600000");
  await page.getByLabel("Send", { exact: true }).click();
  await shown(page, "This profile hit its usage limit").waitFor({ timeout: 30_000 });

  h.step("App: Continue on another profile → Personal");
  await shown(page, "Continue on another profile").click();
  await shown(page, "Personal · fake").click();
  await h.check("a new chat opens and the agent on Personal gets the brief", async () => {
    await page
      .getByText("Continued from a chat on Work (fake).", { exact: false })
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 30_000 });
    await page
      .getByText('You said: You are taking over a task from fake (profile "Work")', { exact: false })
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 30_000 });
  });
  await h.check("in the same worktree, on Personal", async () => {
    const chats = await h.send("chat.list", { worktreeId: wt.id });
    const next = chats.find((c) => c.handedOffFrom === chat.id);
    assert.ok(next);
    assert.notEqual(next.profileId, work);
    assert.match(page.url(), new RegExp(`/chat/${next.id}$`));
  });
}

/** Phase 4c in the app: Settings edits the instructions every profile shares; the next turn reads them. */
export async function sharedConfigFromApp(h: Harness, app: AppDriver): Promise<void> {
  const { page } = app;
  h.step("Desktop: a repo, a profile and a shared MCP server");
  h.makeRepo("shop");
  const repo = await h.send("repo.add", { path: `${h.src}/shop` });
  const profileId = await h.addProfile("Work");
  const added = await h.cli(["config", "shared", "mcp", "add", "github", "--", "gh-mcp"]);
  assert.equal(added.code, 0, added.out);
  await signInApp(h, app);
  await linkFromApp(h, app, "laptop");

  h.step("App: Settings → Shared with every profile → write the instructions, save");
  await app.goto("/settings");
  await shown(page, "Shared with every profile").waitFor({ timeout: 30_000 });
  await h.check("the MCP server added on the computer is listed", async () => {
    await shown(page, "github · gh-mcp").waitFor({ timeout: 30_000 });
  });
  await page.getByLabel("Instructions", { exact: true }).fill("Prefer small commits.");
  await shown(page, "Save instructions").click();
  await shown(page, "Saved").waitFor({ timeout: 30_000 });

  h.step("Desktop: a chat on Work reads them");
  let since = h.mark();
  const wt = await h.send("worktree.create", { repoId: repo.id, branch: "rules", title: "Rules" });
  await h.waitReady(wt.id, since);
  since = h.mark();
  const chat = await h.send("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
  await h.waitStatus(chat.id, "idle", since);
  since = h.mark();
  await h.send("chat.send", { chatId: chat.id, text: "#script:instructions-report" });
  await h.check("the agent read what the app saved", async () => {
    await h.waitText(chat.id, "Instructions: Prefer small commits.", since);
  });
}
