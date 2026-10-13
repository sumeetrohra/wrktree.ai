import type { TDiffSummary } from "#src/modules/git/index.js";
import type { THandoffContext } from "#src/modules/sessions/index.js";

export type THandoffBriefInput = THandoffContext & {
  from: { agent: string; profile: string; limited: boolean };
  /** The worktree's changes against its base, or null when git couldn't say. */
  diff: TDiffSummary | null;
  /** Messages the user had queued on the old chat. */
  unsent: string[];
};

const MAX_FILES = 50;

/**
 * The first message of a handed-off chat (Phase 4b), built without a model call because the old
 * agent is usually the one at its limit: what was said, the plan, what changed, what was pending,
 * and what the user still wants.
 */
export function handoffBrief(b: THandoffBriefInput): string {
  const why = b.from.limited ? "it reached its usage limit" : "the user moved the work";
  const out: string[] = [
    `You are taking over a task from ${b.from.agent} (profile "${b.from.profile}") in this same worktree; ${why}. ` +
      "Read the hand-off below, check the files as they are now, and carry on from where it stopped.",
  ];
  if (b.title) out.push(`Task: ${b.title}`);
  if (b.transcript.length > 0) {
    out.push("## Conversation so far", b.transcript.map((t) => `${t.role}: ${t.text}`).join("\n\n"));
  }
  if (b.plan.length > 0) {
    out.push("## Its last plan", b.plan.map((e) => `- [${e.status}] ${e.text}`).join("\n"));
  }
  if (b.diff && b.diff.files.length > 0) {
    const files = b.diff.files.slice(0, MAX_FILES).map((f) => {
      const counts = f.status === "binary" ? "binary" : `+${String(f.added)} -${String(f.removed)}`;
      return `- ${f.status} ${f.path} (${counts})`;
    });
    const more = b.diff.files.length - MAX_FILES;
    out.push(
      "## Changes in the worktree so far",
      [...files, ...(more > 0 ? [`- … and ${String(more)} more files`] : [])].join("\n"),
    );
  }
  if (b.pending.length > 0) {
    out.push("## It was waiting for approval to", b.pending.map((p) => `- ${p}`).join("\n"));
  }
  const next = [...(b.unanswered === null ? [] : [b.unanswered]), ...b.unsent];
  out.push(
    "## What the user wants next",
    next.length > 0 ? next.join("\n\n") : "Continue the task; say briefly what you will do first.",
  );
  return out.join("\n\n");
}
