import { AgentdeckError, type TCompare, type TCompareTarget } from "@agentdeck/protocol";
import { newId, now } from "@agentdeck/shared";
import { z } from "zod";

import type { TRuntime } from "#src/infra/runtime/index.js";

const compareRowSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  title: z.string(),
  prompt: z.string(),
  base_ref: z.string(),
  created_at: z.number(),
  winner: z.string().nullable(),
});
const entryRowSchema = z.object({
  compare_id: z.string(),
  idx: z.number(),
  worktree_id: z.string(),
  profile_id: z.string(),
  agent: z.string(),
  model: z.string().nullable(),
  chat_id: z.string().nullable(),
  error: z.string().nullable(),
});

/**
 * Compares (Phase 5): one task given to several agents, each in its own worktree. This module
 * keeps the record; the app layer creates the worktrees and starts the chats.
 */
export class CompareService {
  constructor(private readonly rt: TRuntime) {}

  create(args: {
    repoId: string;
    title: string;
    prompt: string;
    baseRef: string;
    entries: readonly (TCompareTarget & { worktreeId: string })[];
  }): TCompare {
    const id = newId("cmp");
    this.rt.db.transaction(() => {
      this.rt.db
        .prepare(
          "INSERT INTO compares (id, repo_id, title, prompt, base_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, args.repoId, args.title, args.prompt, args.baseRef, now());
      args.entries.forEach((e, i) => {
        this.rt.db
          .prepare(
            "INSERT INTO compare_entries (compare_id, idx, worktree_id, profile_id, agent, model) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, i, e.worktreeId, e.profileId, e.agent, e.model ?? null);
      });
    })();
    return this.publish(id);
  }

  get(id: string): TCompare {
    const row = compareRowSchema
      .optional()
      .parse(this.rt.db.prepare("SELECT * FROM compares WHERE id = ?").get(id));
    if (row === undefined) throw new AgentdeckError("NOT_FOUND", `No compare ${id}`);
    const entries = z
      .array(entryRowSchema)
      .parse(this.rt.db.prepare("SELECT * FROM compare_entries WHERE compare_id = ? ORDER BY idx").all(id));
    return {
      id: row.id,
      repoId: row.repo_id,
      title: row.title,
      prompt: row.prompt,
      baseRef: row.base_ref,
      createdAt: row.created_at,
      winner: row.winner,
      entries: entries.map((e) => ({
        profileId: e.profile_id,
        agent: e.agent,
        ...(e.model === null ? {} : { model: e.model }),
        worktreeId: e.worktree_id,
        chatId: e.chat_id,
        error: e.error,
      })),
    };
  }

  list(repoId: string): TCompare[] {
    return z
      .array(z.object({ id: z.string() }))
      .parse(this.rt.db.prepare("SELECT id FROM compares WHERE repo_id = ? ORDER BY created_at").all(repoId))
      .map((r) => this.get(r.id));
  }

  /** The compare entry a worktree belongs to, if any, while it still waits for its chat. */
  waiting(worktreeId: string): { compare: TCompare; target: TCompareTarget } | null {
    const row = entryRowSchema
      .optional()
      .parse(
        this.rt.db
          .prepare(
            "SELECT * FROM compare_entries WHERE worktree_id = ? AND chat_id IS NULL AND error IS NULL",
          )
          .get(worktreeId),
      );
    if (row === undefined) return null;
    return {
      compare: this.get(row.compare_id),
      target: {
        profileId: row.profile_id,
        agent: row.agent,
        ...(row.model === null ? {} : { model: row.model }),
      },
    };
  }

  /** The entry's chat started (`chatId`), or couldn't (`error`). */
  settle(worktreeId: string, result: { chatId: string } | { error: string }): TCompare {
    const row = z
      .object({ compare_id: z.string() })
      .optional()
      .parse(
        this.rt.db.prepare("SELECT compare_id FROM compare_entries WHERE worktree_id = ?").get(worktreeId),
      );
    if (row === undefined) throw new AgentdeckError("NOT_FOUND", `No compare for worktree ${worktreeId}`);
    this.rt.db
      .prepare("UPDATE compare_entries SET chat_id = ?, error = ? WHERE worktree_id = ?")
      .run("chatId" in result ? result.chatId : null, "error" in result ? result.error : null, worktreeId);
    return this.publish(row.compare_id);
  }

  pick(id: string, worktreeId: string): TCompare {
    const c = this.get(id);
    if (!c.entries.some((e) => e.worktreeId === worktreeId)) {
      throw new AgentdeckError("INVALID_ARGS", "That worktree isn't part of this compare");
    }
    this.rt.db.prepare("UPDATE compares SET winner = ? WHERE id = ?").run(worktreeId, id);
    return this.publish(id);
  }

  private publish(id: string): TCompare {
    const compare = this.get(id);
    this.rt.bus.publish(`repo:${compare.repoId}`, { type: "compare.updated", compare });
    return compare;
  }
}
