import { AgentdeckError, type TCompare, type TWorktree } from "@agentdeck/protocol";

import type { TModules } from "./app.types.js";

/**
 * `compare.start`: one worktree per target from the same base, then the record. If a worktree
 * can't be created (a branch already exists), the ones already made are deleted again.
 */
export async function startCompare(
  m: TModules,
  a: {
    repoId: string;
    baseRef?: string | undefined;
    branch: string;
    title: string;
    prompt: string;
    targets: readonly { profileId: string; agent: string; model?: string | undefined }[];
  },
): Promise<TCompare> {
  for (const t of a.targets) {
    const profile = m.profiles.get(t.profileId);
    if (profile.agent !== t.agent) {
      throw new AgentdeckError("INVALID_ARGS", `Profile "${profile.name}" belongs to ${profile.agent}`);
    }
  }
  const made: TWorktree[] = [];
  try {
    for (const [i, t] of a.targets.entries()) {
      made.push(
        await m.worktrees.create({
          repoId: a.repoId,
          baseRef: a.baseRef,
          branch: `${a.branch}-${String(i + 1)}`,
          title: `${a.title} (${m.profiles.get(t.profileId).name}${t.model ? ` · ${t.model}` : ""})`,
        }),
      );
    }
  } catch (e) {
    await m.worktrees.idle();
    for (const wt of made) await m.worktrees.delete(wt.id).catch(() => undefined);
    throw e;
  }
  const first = made[0];
  if (first === undefined) throw new AgentdeckError("INVALID_ARGS", "No targets");
  const compare = m.compare.create({
    repoId: a.repoId,
    title: a.title,
    prompt: a.prompt,
    baseRef: first.baseRef,
    entries: a.targets.map((t, i) => ({ ...t, worktreeId: made[i]?.id ?? "" })),
  });
  // A worktree may have become ready before the record existed.
  for (const wt of made) advanceCompare(m, m.worktrees.get(wt.id));
  return m.compare.get(compare.id);
}

/**
 * A worktree changed: if it belongs to a compare and waits for its chat, start the chat with the
 * compare's prompt once the worktree is ready, or record why it can't.
 */
export function advanceCompare(m: TModules, wt: TWorktree): void {
  if (wt.status !== "ready" && wt.status !== "setup_failed") return;
  const waiting = m.compare.waiting(wt.id);
  if (waiting === null) return;
  if (wt.status === "setup_failed") {
    m.compare.settle(wt.id, { error: wt.setupError ?? "Setup failed" });
    return;
  }
  const { compare, target } = waiting;
  try {
    const chat = m.sessions.create({
      worktreeId: wt.id,
      agent: target.agent,
      profileId: target.profileId,
      title: compare.title,
      model: target.model,
    });
    m.sessions.send(chat.id, compare.prompt);
    m.compare.settle(wt.id, { chatId: chat.id });
  } catch (e) {
    m.compare.settle(wt.id, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** `compare.pick`: keep one worktree, archive the others. */
export async function pickCompare(m: TModules, compareId: string, worktreeId: string): Promise<TCompare> {
  const picked = m.compare.pick(compareId, worktreeId);
  for (const e of picked.entries) {
    if (e.worktreeId === worktreeId) continue;
    const wt = m.worktrees.get(e.worktreeId);
    if (wt.archivedAt === null) await m.worktrees.archive(wt.id);
  }
  return m.compare.get(compareId);
}
