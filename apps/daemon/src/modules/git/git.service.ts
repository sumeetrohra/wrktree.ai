import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AgentdeckError,
  type TBlobRef,
  type TDiffFile,
  type TGitStatus,
  type TWorktree,
} from "@agentdeck/protocol";

import { assertSafeGitArg, childEnv, git } from "#src/infra/process/index.js";

import type { IBlobWriter, IPathPolicy, TDiffAgainst } from "./git.types.js";

export type TDiffSummary = { against: string; files: TDiffFile[] };

const countLines = (text: string): number =>
  text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** Never let git wait for a password prompt nobody can answer. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0" };

/**
 * Git views of a worktree (diffs, status) and the writes that ship it: commit, push, and a local
 * merge into the base checkout for repos without a remote. Writes touch only the worktree's own
 * branch (SEC5: every client value is checked before it reaches git).
 */
export class GitService {
  constructor(private readonly blobs: IBlobWriter) {}

  /** `base`: the merge-base with the worktree's base ref. `head`: uncommitted changes only. */
  private async ref(wt: TWorktree, against: TDiffAgainst): Promise<string> {
    if (against === "head") return "HEAD";
    const base = assertSafeGitArg(wt.baseRef, "base ref");
    const mb = await git(wt.path, ["merge-base", base, "HEAD"], [1, 128]);
    return mb.trim() || base;
  }

  async summary(wt: TWorktree, jail: IPathPolicy, against: TDiffAgainst = "base"): Promise<TDiffSummary> {
    const ref = await this.ref(wt, against);
    const files = new Map<string, TDiffFile>();
    const status = await git(wt.path, ["diff", "--no-renames", "--name-status", ref, "--"]);
    for (const line of status.split("\n").filter(Boolean)) {
      const [code, path] = line.split("\t");
      if (path === undefined || jail.isHidden(path)) continue;
      const s = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
      files.set(path, { path, added: 0, removed: 0, status: s });
    }
    const numstat = await git(wt.path, ["diff", "--no-renames", "--numstat", ref, "--"]);
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [a, r, path] = line.split("\t");
      const f = path === undefined ? undefined : files.get(path);
      if (!f) continue;
      if (a === "-") f.status = "binary";
      else {
        f.added = Number(a);
        f.removed = Number(r);
      }
    }
    const untracked = await git(wt.path, ["ls-files", "--others", "--exclude-standard", "-z"]);
    for (const path of untracked.split("\0").filter(Boolean)) {
      if (jail.isHidden(path)) continue;
      const bytes = readFileSync(join(wt.path, path));
      files.set(
        path,
        bytes.includes(0)
          ? { path, added: 0, removed: 0, status: "binary" }
          : { path, added: countLines(bytes.toString("utf8")), removed: 0, status: "untracked" },
      );
    }
    return {
      against: against === "head" ? "HEAD" : wt.baseRef,
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async fileDiff(
    wt: TWorktree,
    jail: IPathPolicy,
    path: string,
    against: TDiffAgainst = "base",
  ): Promise<TBlobRef> {
    const { rel } = jail.resolve(path);
    const ref = await this.ref(wt, against);
    let diff = await git(wt.path, ["diff", "--no-renames", ref, "--", rel]);
    if (!diff) {
      const untracked = await git(wt.path, ["ls-files", "--others", "--exclude-standard", "--", rel]);
      if (untracked.trim()) diff = await git(wt.path, ["diff", "--no-index", "--", "/dev/null", rel], [1]);
    }
    if (!diff) throw new AgentdeckError("NOT_FOUND", `No changes in ${rel}`);
    return this.blobs.put(Buffer.from(diff), "text/x-diff");
  }

  async status(wt: TWorktree): Promise<TGitStatus> {
    const branch = (await git(wt.path, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const upstreamOut = await git(
      wt.path,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      [128],
    );
    const upstream = upstreamOut.trim() || null;
    // With an upstream: against it. Without one: commits since the base branch, nothing behind.
    const [behind, ahead] = upstream
      ? (await git(wt.path, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]))
          .trim()
          .split(/\s+/)
          .map((n) => Number(n) || 0)
      : [
          0,
          Number(
            (
              await git(
                wt.path,
                ["rev-list", "--count", `${assertSafeGitArg(wt.baseRef, "base ref")}..HEAD`],
                [128],
              )
            ).trim() || 0,
          ),
        ];
    const porcelain = await git(wt.path, [
      "status",
      "--porcelain",
      "-z",
      "--no-renames",
      "--untracked-files=all",
    ]);
    const dirty = porcelain.split("\0").filter(Boolean).length;
    const log = (await git(wt.path, ["log", "-1", "--format=%H%x00%s%x00%ct"], [128])).trim();
    const [sha, subject, at] = log.split("\0");
    const remotes = (await git(wt.path, ["remote"])).split("\n").map((r) => r.trim());
    return {
      branch,
      upstream,
      ahead: ahead ?? 0,
      behind: behind ?? 0,
      dirty,
      lastCommit: sha && subject !== undefined ? { sha, subject, at: Number(at) * 1000 } : null,
      hasRemote: remotes.includes("origin"),
    };
  }

  /** Commits staged changes (`all`: everything, untracked files included). The message goes in on stdin. */
  async commit(wt: TWorktree, message: string, all = false): Promise<{ sha: string }> {
    if (all) await git(wt.path, ["add", "-A"]);
    const staged = (await git(wt.path, ["diff", "--cached", "--name-only"])).trim();
    if (!staged) throw new AgentdeckError("BAD_STATE", "Nothing to commit");
    await git(wt.path, ["commit", "-F", "-"], [], { input: message });
    return { sha: (await git(wt.path, ["rev-parse", "HEAD"])).trim() };
  }

  /** Pushes the worktree's branch to `origin` and sets it as the upstream. */
  async push(wt: TWorktree): Promise<{ branch: string; remote: string }> {
    const branch = assertSafeGitArg(wt.branch, "branch");
    if (!(await this.status(wt)).hasRemote) {
      throw new AgentdeckError(
        "BAD_STATE",
        "This repo has no `origin` remote; merge into the base branch instead",
      );
    }
    await git(wt.path, ["push", "-u", "origin", branch], [], { env: childEnv(NO_PROMPT) });
    return { branch, remote: "origin" };
  }

  /**
   * Merges the worktree's branch into the repo's base checkout (`repoPath`), which must be on the
   * worktree's base branch with no local changes. A conflict is aborted and reported.
   */
  async mergeToBase(wt: TWorktree, repoPath: string): Promise<{ sha: string }> {
    const branch = assertSafeGitArg(wt.branch, "branch");
    const base = assertSafeGitArg(wt.baseRef, "base ref");
    const current = (await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (current !== base) {
      throw new AgentdeckError("BAD_STATE", `The repo is on ${current}, not ${base}; switch it back first`);
    }
    if ((await git(repoPath, ["status", "--porcelain"])).trim()) {
      throw new AgentdeckError("BAD_STATE", `The repo's ${base} checkout has uncommitted changes`);
    }
    try {
      await git(repoPath, ["merge", "--no-ff", "--no-edit", branch]);
    } catch (e) {
      await git(repoPath, ["merge", "--abort"], [128]);
      throw new AgentdeckError("CONFLICT", `${branch} doesn't merge cleanly into ${base}`, false, {
        cause: e instanceof Error ? e.message : String(e),
      });
    }
    return { sha: (await git(repoPath, ["rev-parse", "HEAD"])).trim() };
  }
}
