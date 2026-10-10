import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentdeckError, type BlobRef, type DiffFile, type Worktree } from "@agentdeck/protocol";
import { git } from "../util/exec.js";
import type { BlobStore } from "./blobs.js";
import type { FileJail } from "./files.js";

/** Read-only git views of a worktree. Commit, push and PRs arrive in Phase 3. */
export class Git {
  constructor(private readonly blobs: BlobStore) {}

  /** `base`: the merge-base with the worktree's base ref. `head`: uncommitted changes only. */
  private async ref(wt: Worktree, against: "base" | "head"): Promise<string> {
    if (against === "head") return "HEAD";
    const mb = await git(wt.path, ["merge-base", wt.baseRef, "HEAD"], [1, 128]);
    return mb.trim() || wt.baseRef;
  }

  async summary(wt: Worktree, jail: FileJail, against: "base" | "head" = "base") {
    const ref = await this.ref(wt, against);
    const files = new Map<string, DiffFile>();
    const status = await git(wt.path, ["diff", "--no-renames", "--name-status", ref]);
    for (const line of status.split("\n").filter(Boolean)) {
      const [code, path] = line.split("\t");
      if (!path || jail.isHidden(path)) continue;
      const s = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
      files.set(path, { path, added: 0, removed: 0, status: s });
    }
    const numstat = await git(wt.path, ["diff", "--no-renames", "--numstat", ref]);
    for (const line of numstat.split("\n").filter(Boolean)) {
      const [a, r, path] = line.split("\t");
      const f = path ? files.get(path) : undefined;
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
      if (bytes.includes(0)) files.set(path, { path, added: 0, removed: 0, status: "binary" });
      else {
        const text = bytes.toString("utf8");
        const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        files.set(path, { path, added: lines, removed: 0, status: "untracked" });
      }
    }
    return {
      against: against === "head" ? "HEAD" : wt.baseRef,
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async fileDiff(
    wt: Worktree,
    jail: FileJail,
    path: string,
    against: "base" | "head" = "base",
  ): Promise<BlobRef> {
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
