/**
 * Runs the Phase 2b app scenarios with Playwright video on, captions every step and check with
 * ffmpeg (libass), and joins them into artifacts/app-e2e.mp4.
 *
 *   pnpm e2e:record:app        (needs the app's web export, ffmpeg and a Playwright Chromium)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AppDriver } from "../src/app/app-driver.ts";
import { appScenarios, cloudAppScenarios } from "../src/app/app-scenarios.ts";
import { Harness, REPO_ROOT, type ISink } from "../src/harness.ts";

const OUT = join(REPO_ROOT, "artifacts");
const TMP = join(OUT, "app-video-tmp");
const W = 390;
const H = 844;

type TCue = { t: number; text: string; kind: "title" | "step" | "check" };

const assTime = (ms: number): string => {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const escapeAss = (s: string): string => s.replace(/[{}]/g, "").replace(/\n/g, " ");

/** Captions: the title for 4 s, then each step until the next; checks flash for 2.5 s. */
function subtitles(cues: TCue[], endMs: number): string {
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${String(W)}`,
    `PlayResY: ${String(H)}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    "Style: Title,DejaVu Sans,22,&H00FFFFFF,&H00000000,&HC0111827,1,3,8,0,5,24,24,0",
    "Style: Step,DejaVu Sans,15,&H00FFFFFF,&H00000000,&HB0111827,0,3,6,0,2,12,12,10",
    "Style: Check,DejaVu Sans,14,&H0080FF80,&H00000000,&HB0111827,1,3,6,0,8,12,12,12",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const steps = cues.filter((c) => c.kind === "step");
  for (const c of cues) {
    // Title text is escaped when the cue is built, so its override tags survive.
    if (c.kind === "title") lines.push(`Dialogue: 2,${assTime(0)},${assTime(4000)},Title,,0,0,0,,${c.text}`);
    if (c.kind === "check")
      lines.push(`Dialogue: 1,${assTime(c.t)},${assTime(c.t + 2500)},Check,,0,0,0,,${escapeAss(c.text)}`);
  }
  steps.forEach((c, i) => {
    const end = steps[i + 1]?.t ?? endMs;
    lines.push(`Dialogue: 0,${assTime(c.t)},${assTime(end)},Step,,0,0,0,,${escapeAss(c.text)}`);
  });
  return lines.join("\n") + "\n";
}

// Under `pnpm emulators` (CLOUD_E2E=1), the cloud history scenarios too.
const ALL = [...appScenarios, ...(process.env["CLOUD_E2E"] === "1" ? cloudAppScenarios : [])];

async function recordScenario(index: number): Promise<{ mp4: string; ok: boolean; title: string }> {
  const s = ALL[index]!;
  process.stdout.write(`\n${String(s.n)}. ${s.title}\n`);
  const cues: TCue[] = [
    {
      t: 0,
      text: `${escapeAss(`${String(s.n)}. ${s.title}`)}\\N\\N{\\fs14}${escapeAss(s.summary)}`,
      kind: "title",
    },
  ];
  let t0 = Date.now();
  const sink: ISink = {
    write: () => undefined,
    step: (text) => {
      cues.push({ t: Date.now() - t0, text, kind: "step" });
      process.stdout.write(`    · ${text}\n`);
    },
    check: (label, ok) => {
      cues.push({ t: Date.now() - t0, text: `${ok ? "✓" : "✗"} ${label}`, kind: "check" });
      process.stdout.write(`      ${ok ? "✓" : "✗"} ${label}\n`);
    },
  };
  const dir = join(TMP, String(s.n));
  let h: Harness | null = null;
  let app: AppDriver | null = null;
  let ok = true;
  let webm: string | null;
  try {
    h = await Harness.start(sink, s.harness);
    app = await AppDriver.start({ videoDir: dir, ...(s.appHost ? { appHost: s.appHost } : {}) });
    t0 = Date.now();
    await app.page.waitForTimeout(3000); // room for the title card
    await s.run(h, app);
    await app.page.waitForTimeout(2500);
  } catch (e) {
    ok = false;
    process.stdout.write(`    ✗ FAILED: ${(e as Error).message.split("\n")[0] ?? ""}\n`);
  } finally {
    webm = (await app?.stop()) ?? null;
    await h?.stop();
  }
  if (!webm) throw new Error("no video recorded");
  const endMs = Date.now() - t0;
  const ass = join(dir, "captions.ass");
  writeFileSync(ass, subtitles(cues, endMs));
  const mp4 = join(dir, "segment.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      webm,
      "-vf",
      `scale=${String(W)}:${String(H)},subtitles=${ass}`,
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
      mp4,
    ],
    { stdio: "inherit" },
  );
  return { mp4, ok, title: s.title };
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const results = [];
  for (let i = 0; i < ALL.length; i++) results.push(await recordScenario(i));
  const list = join(TMP, "list.txt");
  writeFileSync(list, results.map((r) => `file '${r.mp4}'`).join("\n") + "\n");
  const out = join(OUT, "app-e2e.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      out,
    ],
    {
      stdio: "inherit",
    },
  );
  if (process.env["KEEP_APP_VIDEO_TMP"] !== "1") rmSync(TMP, { recursive: true, force: true });
  const passed = results.filter((r) => r.ok).length;
  process.stdout.write(
    `\n${String(passed)}/${String(results.length)} app scenarios passed · video: ${out}\n`,
  );
  if (passed !== results.length) process.exitCode = 1;
}

await main();
