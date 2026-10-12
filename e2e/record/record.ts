/**
 * Runs every Phase 1 and Phase 2 scenario under a recording sink, then replays the
 * captured terminals in record/player.html inside headless Chromium with
 * video recording on, and encodes artifacts/e2e.mp4.
 *
 *   pnpm e2e:record            (needs ffmpeg and a Playwright Chromium)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform, release } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";

import { Harness, REPO_ROOT, type ISink } from "../src/harness.ts";
import { relayScenarios, scenarios } from "../src/scenarios/index.ts";

const require = createRequire(import.meta.url);
const OUT = join(REPO_ROOT, "artifacts");
const IDLE_CAP_MS = 1200;
const INTRO_MS = 6000;
const TITLE_MS = 4500;
const RESULT_MS = 3000;
/** Breathing room so a viewer can follow: before each step and command, after each assertion. */
const STEP_PAUSE_MS = 1600;
const COMMAND_PAUSE_MS = 700;
const CHECK_PAUSE_MS = 450;

type TRec =
  | { t: number; kind: "out"; pane: "cmd" | "events"; data: string }
  | { t: number; kind: "step"; text: string }
  | { t: number; kind: "check"; label: string; ok: boolean; detail?: string }
  | { t: number; kind: "scenario"; n: number; title: string; summary: string; covers: string[] }
  | { t: number; kind: "result"; n: number; ok: boolean; error?: string };

type TRow = { n: number; title: string; ok: boolean; checks: number; ms: number; error?: string };

function gitSha(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT }).toString().trim()
      ? "+dirty"
      : "";
    return sha + dirty;
  } catch {
    return "unknown";
  }
}

async function runScenarios(): Promise<{ recs: TRec[]; rows: TRow[]; totalMs: number }> {
  const recs: TRec[] = [];
  const rows: TRow[] = [];
  const t0 = Date.now();
  const t = () => Date.now() - t0;
  let checks = 0;
  const sink: ISink = {
    write: (pane, data) => recs.push({ t: t(), kind: "out", pane, data }),
    step: (text) => {
      recs.push({ t: t(), kind: "step", text });
      process.stdout.write(`    · ${text}\n`);
    },
    check: (label, ok, detail) => {
      checks++;
      recs.push({ t: t(), kind: "check", label, ok, ...(detail ? { detail } : {}) });
      process.stdout.write(`      ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}\n`);
    },
  };
  const all = [
    ...scenarios.map((s) => ({ s, relay: false })),
    ...relayScenarios.map((s) => ({ s, relay: true })),
  ];
  for (const { s, relay } of all) {
    process.stdout.write(`\n${s.n}. ${s.title}\n`);
    recs.push({ t: t(), kind: "scenario", n: s.n, title: s.title, summary: s.summary, covers: s.covers });
    const started = Date.now();
    checks = 0;
    let h: Harness | null = null;
    let error: string | undefined;
    try {
      h = await Harness.start(sink, { relay });
      await s.run(h);
    } catch (e) {
      error = (e as Error).message.split("\n")[0];
      process.stdout.write(`    ✗ FAILED: ${error}\n`);
    } finally {
      await h?.stop();
    }
    const ok = error === undefined;
    recs.push({ t: t(), kind: "result", n: s.n, ok, ...(error ? { error } : {}) });
    rows.push({ n: s.n, title: s.title, ok, checks, ms: Date.now() - started, ...(error ? { error } : {}) });
  }
  return { recs, rows, totalMs: t() };
}

/** Real time, with idle gaps capped and title cards inserted. */
function playback(recs: TRec[], rows: TRow[], totalMs: number, meta: string) {
  const events: Record<string, unknown>[] = [{ at: 0, kind: "intro", meta }];
  let play = INTRO_MS;
  let last = 0;
  for (const r of recs) {
    if (r.kind === "scenario") {
      events.push({ ...r, at: play });
      play += TITLE_MS;
      events.push({ at: play, kind: "play" });
      last = r.t;
      continue;
    }
    play += Math.min(Math.max(0, r.t - last), IDLE_CAP_MS);
    last = r.t;
    if (r.kind === "step") play += STEP_PAUSE_MS;
    if (r.kind === "out" && r.pane === "cmd" && r.data.startsWith("\x1b[1;32m$")) play += COMMAND_PAUSE_MS;
    events.push({ ...r, at: play });
    if (r.kind === "check") play += CHECK_PAUSE_MS;
    if (r.kind === "result") play += RESULT_MS;
  }
  const passed = rows.filter((r) => r.ok).length;
  events.push({
    at: play,
    kind: "summary",
    rows,
    passed,
    total: rows.length,
    checks: rows.reduce((a, r) => a + r.checks, 0),
    ms: totalMs,
    meta,
  });
  return { total: scenarios.length + relayScenarios.length, events, tail: 9000, durationMs: play + 9000 };
}

function buildHtml(pb: ReturnType<typeof playback>): string {
  const dir = new URL(".", import.meta.url);
  const xtermDir = join(require.resolve("@xterm/xterm/package.json"), "..");
  const fitJs = require.resolve("@xterm/addon-fit");
  return readFileSync(new URL("player.html", dir), "utf8")
    .replace("/*XTERM_CSS*/", () => readFileSync(join(xtermDir, "css", "xterm.css"), "utf8"))
    .replace("/*XTERM_JS*/", () => readFileSync(join(xtermDir, "lib", "xterm.js"), "utf8"))
    .replace("/*FIT_JS*/", () => readFileSync(fitJs, "utf8"))
    .replace("/*PLAYBACK*/", () => JSON.stringify(pb).replace(/</g, "\\u003c"))
    .replace("/*PLAYER_JS*/", () => readFileSync(new URL("player.js", dir), "utf8"));
}

async function render(htmlPath: string, durationMs: number, mp4: string): Promise<void> {
  const videoDir = join(OUT, "video-tmp");
  rmSync(videoDir, { recursive: true, force: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(800);
  await page.evaluate("window.__start()");
  await page.waitForFunction("window.__done === true", undefined, {
    timeout: durationMs + 120_000,
    polling: 500,
  });
  const video = page.video()!;
  await context.close();
  await browser.close();
  const webm = await video.path();
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      "0.8",
      "-i",
      webm,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "25",
      "-movflags",
      "+faststart",
      mp4,
    ],
    { stdio: "inherit" },
  );
  rmSync(videoDir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const meta = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · commit ${gitSha()} · ${platform()} ${release()} ${arch()} · Node ${process.versions.node}`;
  const { recs, rows, totalMs } = await runScenarios();
  writeFileSync(join(OUT, "e2e-results.json"), JSON.stringify({ meta, rows, totalMs }, null, 2));
  const pb = playback(recs, rows, totalMs, meta);
  const htmlPath = join(OUT, "e2e-player.html");
  writeFileSync(htmlPath, buildHtml(pb));
  const mp4 = join(OUT, "e2e.mp4");
  process.stdout.write(`\nRendering ${(pb.durationMs / 1000).toFixed(0)} s of video…\n`);
  await render(htmlPath, pb.durationMs, mp4);
  const passed = rows.filter((r) => r.ok).length;
  process.stdout.write(`\n${passed}/${rows.length} scenarios passed · video: ${mp4}\n`);
  if (passed !== rows.length) process.exitCode = 1;
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
