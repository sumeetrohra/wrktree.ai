import type { TUsageSnapshot } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";
import { z } from "zod";

import type { TRuntime } from "#src/infra/runtime/index.js";

const totalsSchema = z.object({ input_tokens: z.number(), output_tokens: z.number() });
const limitRowSchema = z.object({ seq: z.number(), at: z.number(), reset_at: z.number().nullable() });
const sumSchema = z.object({ input: z.number().nullable(), output: z.number().nullable() });
const lastSchema = z.object({ seq: z.number().nullable() });

/** Midnight today, this computer's time. */
function startOfToday(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Usage per profile (Phase 4a): turns and their tokens, and usage limits with their reset time,
 * in `usage_samples`. A turn that completes after a limit (in row order) clears it; so does the reset time
 * passing. Every change publishes `usage.updated` with the profile's snapshot.
 */
export class UsageService {
  constructor(private readonly rt: TRuntime) {}

  private insert(
    profileId: string,
    input: number | null,
    output: number | null,
    limit: boolean,
    resetAt: number | null,
  ): void {
    this.rt.db
      .prepare(
        "INSERT INTO usage_samples (profile_id, at, input_tokens, output_tokens, limit_hit, reset_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(profileId, now(), input, output, limit ? 1 : 0, resetAt);
  }

  private publish(profileId: string): void {
    this.rt.bus.publish("global", { type: "usage.updated", profileId, usage: this.snapshot(profileId) });
  }

  /** `usage` is the session's running total (ACP); this turn's share is the growth since the last. */
  turnEnded(
    profileId: string,
    chatId: string,
    usage: { inputTokens: number; outputTokens: number } | null,
  ): void {
    let input: number | null = null;
    let output: number | null = null;
    if (usage) {
      const prev = totalsSchema
        .optional()
        .parse(
          this.rt.db
            .prepare("SELECT input_tokens, output_tokens FROM usage_chat_totals WHERE chat_id = ?")
            .get(chatId),
        );
      // A smaller total means a new agent session (e.g. after a restart): count it from zero.
      const grew = prev && usage.inputTokens >= prev.input_tokens && usage.outputTokens >= prev.output_tokens;
      input = grew ? usage.inputTokens - prev.input_tokens : usage.inputTokens;
      output = grew ? usage.outputTokens - prev.output_tokens : usage.outputTokens;
      this.rt.db
        .prepare(
          "INSERT INTO usage_chat_totals (chat_id, input_tokens, output_tokens) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens",
        )
        .run(chatId, usage.inputTokens, usage.outputTokens);
    }
    this.insert(profileId, input, output, false, null);
    this.publish(profileId);
  }

  limitHit(profileId: string, resetAt?: number): void {
    this.insert(profileId, null, null, true, resetAt ?? null);
    this.publish(profileId);
  }

  lifted(profileId: string): void {
    this.insert(profileId, null, null, false, null);
    this.publish(profileId);
  }

  snapshot(profileId: string): TUsageSnapshot {
    const t = now();
    const db = this.rt.db;
    const limit = limitRowSchema
      .optional()
      .parse(
        db
          .prepare(
            "SELECT rowid AS seq, at, reset_at FROM usage_samples WHERE profile_id = ? AND limit_hit = 1 ORDER BY rowid DESC LIMIT 1",
          )
          .get(profileId),
      );
    const cleared = lastSchema.parse(
      db
        .prepare("SELECT MAX(rowid) AS seq FROM usage_samples WHERE profile_id = ? AND limit_hit = 0")
        .get(profileId),
    ).seq;
    const sum = sumSchema.parse(
      db
        .prepare(
          "SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output FROM usage_samples WHERE profile_id = ? AND at >= ?",
        )
        .get(profileId, startOfToday(t)),
    );
    const limited =
      limit !== undefined &&
      (cleared === null || cleared < limit.seq) &&
      (limit.reset_at === null || limit.reset_at > t);
    return {
      limitHit: limited,
      ...(limited && limit.reset_at !== null ? { resetAt: limit.reset_at } : {}),
      ...(limited ? { limitedAt: limit.at } : {}),
      ...(sum.input === null ? {} : { inputTokens: sum.input }),
      ...(sum.output === null ? {} : { outputTokens: sum.output }),
    };
  }
}
