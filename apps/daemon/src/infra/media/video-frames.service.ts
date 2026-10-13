import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentdeckError } from "@agentdeck/protocol";

import { run } from "#src/infra/process/index.js";

/** Frames an agent gets from one video, spread evenly over it. */
const MAX_FRAMES = 8;
/** One frame per second, for up to this many seconds, before picking `MAX_FRAMES`. */
const MAX_SECONDS = 300;

const EXT: Readonly<Record<string, string>> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/3gpp": "3gp",
};

/** `count` indexes spread evenly over `n` items, first and last included. */
export function spread(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
}

/**
 * Key frames of a video as JPEGs (at most 1280 px wide), through `ffmpeg` on this computer: one a
 * second, then up to eight spread over the clip. `ffmpeg` is the command, e.g. `["ffmpeg"]`.
 * Throws NOT_FOUND when ffmpeg isn't installed.
 */
export async function videoFrames(ffmpeg: readonly string[], video: Buffer, mime: string): Promise<Buffer[]> {
  const [bin, ...pre] = ffmpeg;
  if (bin === undefined) throw new AgentdeckError("NOT_FOUND", "No ffmpeg configured");
  const dir = mkdtempSync(join(tmpdir(), "agentdeck-video-"));
  try {
    const input = join(dir, `in.${EXT[mime] ?? "mp4"}`);
    writeFileSync(input, video);
    const args = [
      ...pre,
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vf",
      "fps=1,scale='min(1280,iw)':-2",
      "-frames:v",
      String(MAX_SECONDS),
      join(dir, "frame-%03d.jpg"),
    ];
    let result;
    try {
      result = await run(bin, args);
    } catch {
      throw new AgentdeckError("NOT_FOUND", "ffmpeg isn't installed on this computer");
    }
    if (result.code !== 0) {
      throw new AgentdeckError(
        "INVALID_ARGS",
        `ffmpeg couldn't read the video: ${result.stderr.trim().slice(0, 300)}`,
      );
    }
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("frame-"))
      .sort();
    return spread(files.length, MAX_FRAMES).map((i) => readFileSync(join(dir, files[i] ?? "")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
