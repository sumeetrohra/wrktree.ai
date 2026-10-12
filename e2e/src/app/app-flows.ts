import assert from "node:assert/strict";

import type { Harness } from "../harness.ts";

import { outboxCode, type AppDriver } from "./app-driver.ts";

const LINK = /(agentdeck:\/\/pair\?o=[A-Za-z0-9_-]+)/;

/** Onboarding in the app: paste the link from `agentdeck pair`, sign in, compare codes. */
export async function pairApp(h: Harness, app: AppDriver, email = "phone@example.com"): Promise<void> {
  const { page } = app;
  await h.waitRelayConnected();
  h.step("App: open it; an unpaired phone lands on pairing");
  await app.goto("/");
  await page.getByText("Pair with your computer").waitFor();

  h.step("Desktop: `agentdeck pair` prints the QR code and link");
  const pairing = h.cliStream(["pair", "--yes"]);
  const [, link = ""] = await pairing.waitFor(LINK);

  h.step("App: paste the link, sign in with the emailed code");
  await page.getByPlaceholder("agentdeck://pair?o=…").fill(link);
  await page.getByText("Continue", { exact: true }).click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByText("Email me a code").click();
  await page.getByPlaceholder("123456").waitFor();
  await page.getByPlaceholder("123456").fill(await outboxCode(h, email));
  await page.getByText("Sign in and pair").click();

  h.step("Both screens show the same code; the desktop confirms");
  const [, desktopCode = ""] = await pairing.waitFor(/Pairing code: (\d{3} \d{3})/, 20_000);
  const phoneCode = (await page.getByTestId("short-code").textContent({ timeout: 20_000 })) ?? "";
  await h.check("the app and the desktop show the same six digits", () => {
    assert.equal(phoneCode.trim(), desktopCode);
  });
  await pairing.done;
  await page.getByText("Repositories").waitFor({ timeout: 30_000 });
}

/** App: New task on a repo → the chat opens and streams; approve the permission; the turn ends. */
export async function newTaskFromApp(h: Harness, app: AppDriver, repo: string, title: string): Promise<void> {
  const { page } = app;
  h.step("App: open the repo, New task");
  await page.getByText(repo, { exact: true }).click();
  await page.getByText("New task", { exact: true }).first().click();
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
    assert.ok(await page.getByText("idle", { exact: true }).isVisible());
  });
}

/** The id of the phone the app registered (the only phone paired with this daemon). */
async function appDeviceId(h: Harness): Promise<string> {
  const devices = await h.send("device.list", {});
  const phone = devices.find((d) => d.kind === "phone");
  if (!phone) throw new Error("no phone paired");
  return phone.id;
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

  // The web build gets no Expo push token; register a stand-in with the phone's own device
  // token, exactly as the native app does after pairing.
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
  await page.getByText("Repositories").waitFor();
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

/** `agentdeck devices revoke` on the desktop: the app is cut off and says so. */
export async function revokeApp(h: Harness, app: AppDriver): Promise<void> {
  const phoneId = await appDeviceId(h);
  h.step("Desktop: `agentdeck devices revoke`");
  const { code, out } = await h.cli(["devices", "revoke", phoneId]);
  assert.equal(code, 0, out);
  await app.goto("/");
  await app.page.getByText("This phone was removed").waitFor({ timeout: 30_000 });
  await h.check("the app shows it was revoked", async () => {
    assert.ok(await app.page.getByText("Pair again to keep using it.", { exact: false }).isVisible());
  });
}

/** The desktop web UI served by the daemon itself: `agentdeck open`, no relay, no pairing. */
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
  await h.check("the page lists the repos over the local connection", async () => {
    assert.ok(await page.getByText("This computer · online").isVisible());
  });

  h.step("The same link in a fresh browser is refused (single use)");
  const other = await app.browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(url);
  await h.check("a used code opens nothing: the second browser lands on pairing", async () => {
    await stranger.getByText("Pair with your computer").waitFor({ timeout: 30_000 });
  });
  await other.close();
}
