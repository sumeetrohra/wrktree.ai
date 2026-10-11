import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AgentdeckError, type TBlobRef, type TDiffFile, type TWorktree } from "@agentdeck/protocol";

import { assertSafeGitArg, git } from "#src/infra/process/index.js";

import type { IBlobWriter, IPathPolicy, TDiffAgainst } from "./git.types.js";

export type TDiffSummary = { against: string; files: TDiffFile[] };

const countLines = (text: string): number =>
  text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** Read-only git views of a worktree. Commit, push and PRs arrive in Phase 3. */
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

  async fileDiff(wt: TWorktree, jail: IPathPolicy, path: string, against: TDiffAgainst = "base"): Promise<TBlobRef> {
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
}
