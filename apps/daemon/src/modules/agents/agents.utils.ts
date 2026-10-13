import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import type { TLimitCheck, TLoginStatus } from "#src/shared/agent-spec.types.js";

import { limitFromText, limitInReply } from "./limit-text.utils.js";

const errorLikeSchema = z.object({ message: z.unknown().optional(), data: z.unknown().optional() });
const usageLimitDataSchema = z.object({ kind: z.literal("usage_limit"), resetAt: z.number().optional() });

function errorText(err: unknown): string {
  const e = errorLikeSchema.safeParse(err);
  if (!e.success) return String(err);
  const message = typeof e.data.message === "string" ? e.data.message : "";
  return `${message} ${JSON.stringify(e.data.data ?? "")}`;
}

/**
 * Usage-limit detection by message text, with the reset time when the text gives one: for agents
 * that report limits only in prose (an adapter error, or the agent's own reply).
 */
export function textLimit(err: unknown, now: number = Date.now()): TLimitCheck {
  return limitFromText(typeof err === "string" ? err : errorText(err), now);
}

/** The fake agent reports limits as `{ data: { kind: "usage_limit", resetAt } }`. */
export function structuredLimit(err: unknown): TLimitCheck {
  const e = errorLikeSchema.safeParse(err);
  const data = e.success ? usageLimitDataSchema.safeParse(e.data.data) : undefined;
  if (data?.success)
    return data.data.resetAt === undefined ? { hit: true } : { hit: true, resetAt: data.data.resetAt };
  return textLimit(err);
}

/** Login status from a credentials file the agent writes into its config folder. */
export function fileLogin(file: string, field: string): (dir: string) => TLoginStatus {
  const schema = z.record(z.string(), z.unknown());
  return (dir) => {
    const p = join(dir, file);
    if (!existsSync(p)) return { loggedIn: false };
    const account = tryParseJson(schema, readFileSync(p, "utf8"))?.[field];
    return typeof account === "string" ? { loggedIn: true, account } : { loggedIn: true };
  };
}

/** A limit the agent reported as its reply (see `limitInReply`). */
export function replyLimit(reply: string): TLimitCheck {
  return limitInReply(reply, Date.now());
}
