import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { spread, videoFrames } from "./video-frames.service.js";

/** Stands in for ffmpeg: writes one tiny "frame" per second of a 20-second clip. */
const FAKE = `const fs = require("node:fs");
const out = process.argv[process.argv.length - 1];
const input = process.argv[process.argv.indexOf("-i") + 1];
if (fs.readFileSync(input, "utf8") !== "a video") { console.error("not a video"); process.exit(1); }
for (let i = 1; i <= 20; i++) fs.writeFileSync(out.replace("%03d", String(i).padStart(3, "0")), "frame " + i);
`;

function fakeFfmpeg(): string[] {
  const dir = mkdtempSync(join(tmpdir(), "fake-ffmpeg-"));
  const script = join(dir, "ffmpeg.cjs");
  writeFileSync(script, FAKE);
  return [process.execPath, script];
}

describe("videoFrames", () => {
  it("spreads up to eight frames over the clip, first and last included", async () => {
    const frames = await videoFrames(fakeFfmpeg(), Buffer.from("a video"), "video/mp4");
    expect(frames.map(String)).toEqual([1, 4, 6, 9, 12, 15, 17, 20].map((i) => `frame ${String(i)}`));
  });

  it("says what went wrong: no ffmpeg, or a file it can't read", async () => {
    await expect(videoFrames(["agentdeck-no-such-ffmpeg"], Buffer.from("x"), "video/mp4")).rejects.toThrow(
      /isn't installed/,
    );
    await expect(videoFrames(fakeFfmpeg(), Buffer.from("garbage"), "video/mp4")).rejects.toThrow(
      /couldn't read the video: not a video/,
    );
  });

  it("spread", () => {
    expect(spread(3, 8)).toEqual([0, 1, 2]);
    expect(spread(9, 3)).toEqual([0, 4, 8]);
    expect(spread(0, 8)).toEqual([]);
  });
});
