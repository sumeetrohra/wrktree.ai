/**
 * Reading usage limits out of what agents print (Phase 4a). Each agent words its limit
 * differently and only some say when it resets; these cover the shapes seen from Claude Code,
 * Codex and Gemini CLI (samples in limit-text.utils.test.ts).
 */

const HIT = [
  /usage limit/i,
  /hit your (?:usage )?limit/i,
  /\b\d+-hour limit reached/i,
  /rate[ _-]?limit/i,
  /quota (?:exceeded|exhausted)/i,
  /exceeded your current quota/i,
  /RESOURCE_EXHAUSTED/,
  /\b429\b/,
];

const UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};

/** "2 hours 13 minutes", "4d 3h", "37.5s" → milliseconds (0 when nothing parses). */
export function durationMs(text: string): number {
  let ms = 0;
  for (const m of text.matchAll(
    /(\d[\d.]*)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi,
  )) {
    const unit =
      (m[2] ?? "").toLowerCase().startsWith("mi") || m[2] === "m"
        ? "m"
        : (m[2] ?? "").charAt(0).toLowerCase();
    ms += Number(m[1]) * (UNIT_MS[unit] ?? 0);
  }
  return Math.round(ms);
}

/** The next time the clock (this computer's zone) shows `h:mm am/pm` after `now`. */
function nextClock(now: number, hour12: number, minute: number, ampm: string): number {
  const h = (hour12 % 12) + (ampm.toLowerCase() === "pm" ? 12 : 0);
  const d = new Date(now);
  d.setHours(h, minute, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** When the limit lifts, if the text says so. */
function resetAtFrom(text: string, now: number): number | undefined {
  // Claude Code: "Claude AI usage limit reached|1760400000" (epoch seconds).
  const epoch = /limit reached\|(\d{10,13})\b/i.exec(text)?.[1];
  if (epoch !== undefined) return epoch.length === 13 ? Number(epoch) : Number(epoch) * 1000;
  // Gemini / Google APIs: "retryDelay": "37s".
  const delay = /"retryDelay"\s*:\s*"(\d[\d.]*)s"/.exec(text)?.[1];
  if (delay !== undefined) return now + Math.round(Number(delay) * 1000);
  // An ISO time after "reset"/"try again"/"retry".
  const iso = /(?:reset|try again|retry)[^\n]*?(\d{4}-\d{2}-\d{2}T[\d:.+Z-]+)/i.exec(text)?.[1];
  if (iso !== undefined && !Number.isNaN(Date.parse(iso))) return Date.parse(iso);
  // Codex / Gemini: "Try again in 2 hours 13 minutes", "Please retry in 37.5s", "resets in 4h".
  const inPhrase = /(?:try again|retry|resets?)\s+in\s+([^\n"]{1,60})/i
    .exec(text)?.[1]
    ?.split(/\.(?:\s|$)/)[0];
  if (inPhrase !== undefined) {
    const ms = durationMs(inPhrase);
    if (ms > 0) return now + ms;
  }
  // Claude Code / Codex: "resets 3pm", "resets at 3:30 PM", "try again at 9am".
  const clock = /(?:resets?|try again) (?:at )?(\d[\d:]{0,4}) ?(am|pm)\b/i.exec(text);
  if (clock?.[1] !== undefined && clock[2] !== undefined) {
    const [hour = "0", minute = "0"] = clock[1].split(":");
    return nextClock(now, Number(hour), Number(minute), clock[2]);
  }
  return undefined;
}

/** Whether `text` reports a usage limit, and when it resets if it says. */
export function limitFromText(text: string, now: number): { hit: boolean; resetAt?: number } {
  if (!HIT.some((r) => r.test(text))) return { hit: false };
  const resetAt = resetAtFrom(text, now);
  return resetAt === undefined ? { hit: true } : { hit: true, resetAt };
}

/** Replies longer than this are real answers, even when they mention limits. */
const REPLY_MAX = 500;
const REPLY_HIT = [/usage limit reached/i, /hit your (?:usage )?limit/i, /\b\d+-hour limit reached/i];

/**
 * Some agents end the turn normally and say they hit the limit. Stricter than `limitFromText`: a
 * short reply that reads like a limit notice, so an answer about rate limiting isn't mistaken.
 */
export function limitInReply(reply: string, now: number): { hit: boolean; resetAt?: number } {
  const text = reply.trim();
  if (text.length === 0 || text.length > REPLY_MAX || !REPLY_HIT.some((r) => r.test(text)))
    return { hit: false };
  const resetAt = resetAtFrom(text, now);
  return resetAt === undefined ? { hit: true } : { hit: true, resetAt };
}
