import { describe, expect, it } from "vitest";

import { durationMs, limitFromText, limitInReply } from "./limit-text.utils.js";

// 2026-10-13 10:00 in this computer's zone.
const NOW = new Date(2026, 9, 13, 10, 0, 0).getTime();
const at = (h: number, m = 0, dayOffset = 0): number => new Date(2026, 9, 13 + dayOffset, h, m, 0).getTime();

describe("limitFromText", () => {
  it.each([
    ["claude, epoch", "Claude AI usage limit reached|1760400000", 1760400000 * 1000],
    ["claude, clock", "5-hour limit reached ∙ resets 3pm", at(15)],
    ["claude, clock with zone", "You've hit your limit · resets 9:30am (Europe/London)", at(9, 30, 1)],
    [
      "codex, duration",
      "You've hit your usage limit. Upgrade to Pro or try again in 2 hours 13 minutes.",
      NOW + (2 * 60 + 13) * 60_000,
    ],
    [
      "codex, days",
      "You've hit your usage limit. Try again in 4 days 3 hours.",
      NOW + (4 * 24 + 3) * 3_600_000,
    ],
    ["codex, clock", "You've hit your usage limit. Try again at 11:45 PM.", at(23, 45)],
    [
      "gemini, retryDelay",
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"37s"}]}}',
      NOW + 37_000,
    ],
    ["gemini, prose", "Quota exceeded for quota metric. Please retry in 12.5s.", NOW + 12_500],
    ["iso", "Rate limit exceeded; resets at 2026-10-13T18:00:00Z", Date.parse("2026-10-13T18:00:00Z")],
  ])("%s", (_name, text, resetAt) => {
    expect(limitFromText(text, NOW)).toEqual({ hit: true, resetAt });
  });

  it("knows a limit without a reset time", () => {
    expect(limitFromText("Usage limit reached for this account", NOW)).toEqual({ hit: true });
  });

  it("ignores ordinary errors", () => {
    expect(limitFromText("ENOENT: no such file, try again in a moment", NOW)).toEqual({ hit: false });
    expect(limitFromText("Agent crashed with exit code 1", NOW)).toEqual({ hit: false });
  });
});

describe("durationMs", () => {
  it("adds up mixed units", () => {
    expect(durationMs("1h 30m")).toBe(90 * 60_000);
    expect(durationMs("2 hours 1 minute 5 seconds")).toBe((2 * 3600 + 65) * 1000);
    expect(durationMs("soon")).toBe(0);
  });
});

describe("limitInReply", () => {
  it("reads a short limit notice the agent sent as its reply", () => {
    expect(limitInReply("Claude AI usage limit reached|1760400000", NOW)).toEqual({
      hit: true,
      resetAt: 1760400000 * 1000,
    });
    expect(limitInReply("5-hour limit reached ∙ resets 3pm", NOW)).toEqual({ hit: true, resetAt: at(15) });
  });

  it("doesn't mistake an answer about rate limits for a limit", () => {
    expect(limitInReply("I added a rate limit to the login route: 429 after 5 tries.", NOW)).toEqual({
      hit: false,
    });
    expect(limitInReply(`You've hit your usage limit? ${"No, ".repeat(200)}`, NOW)).toEqual({ hit: false });
  });
});
