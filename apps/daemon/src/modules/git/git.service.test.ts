import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TWorktree } from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { git } from "#src/infra/process/index.js";

import { GitService } from "./git.service.js";

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await git(cwd, args)).trim();

/** A repo on `main` with one commit, a worktree on `feature`, and optionally a bare `origin`. */
async function setup(withOrigin = false) {
  const root = mkdtempSync(join(tmpdir(), "git-svc-"));
  const repo = join(root, "repo");
  await sh(root, "init", "-q", "-b", "main", repo);
  for (const [k, v] of [
    ["user.email", "t@agentdeck.dev"],
    ["user.name", "T"],
    ["commit.gpgsign", "false"],
    // Windows runners default to CRLF checkouts; the assertions compare exact bytes.
    ["core.autocrlf", "false"],
  ] as const) {
    await sh(repo, "config", k, v);
  }
  writeFileSync(join(repo, "README.md"), "hello\n");
  await sh(repo, "add", "-A");
  await sh(repo, "commit", "-q", "-m", "Initial commit");
  const origin = join(root, "origin.git");
  if (withOrigin) {
    await sh(root, "init", "-q", "--bare", "-b", "main", origin);
    await sh(repo, "remote", "add", "origin", origin);
    await sh(repo, "push", "-q", "origin", "main");
  }
  const path = join(root, "wt");
  await sh(repo, "worktree", "add", "-q", "-b", "feature", path);
  const wt: TWorktree = {
    id: newId("wt"),
    repoId: newId("repo"),
    title: "Feature",
    branch: "feature",
    baseRef: "main",
    path,
    status: "ready",
    port: null,
    setupError: null,
    createdAt: 1,
    archivedAt: null,
  };
  return { repo, origin, wt, git: new GitService({ put: () => ({ blobId: "x", mime: "x", size: 0 }) }) };
}

// Each case runs a dozen git commands; on Windows runners that takes several seconds.
describe("GitService writes", { timeout: 30_000 }, () => {
  it("reports status: branch, uncommitted files, commits ahead of base, no remote", async () => {
    const t = await setup();
    writeFileSync(join(t.wt.path, "a.txt"), "a\n");
    writeFileSync(join(t.wt.path, "README.md"), "changed\n");
    const s = await t.git.status(t.wt);
    expect(s).toMatchObject({ branch: "feature", upstream: null, ahead: 0, dirty: 2, hasRemote: false });
    expect(s.lastCommit?.subject).toBe("Initial commit");
  });

  it("commits everything with the message from stdin, then has nothing left to commit", async () => {
    const t = await setup();
    writeFileSync(join(t.wt.path, "a.txt"), "a\n");
    const message = "Add a\n\n- with a body line; $(not a shell)";
    const { sha } = await t.git.commit(t.wt, message, true);
    expect(await sh(t.wt.path, "log", "-1", "--format=%B")).toBe(message);
    expect(await sh(t.wt.path, "rev-parse", "HEAD")).toBe(sha);
    expect(await t.git.status(t.wt)).toMatchObject({ dirty: 0, ahead: 1 });
    await expect(t.git.commit(t.wt, "again", true)).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("pushes the branch to origin and tracks it", async () => {
    const t = await setup(true);
    writeFileSync(join(t.wt.path, "a.txt"), "a\n");
    const { sha } = await t.git.commit(t.wt, "Add a", true);
    expect(await t.git.push(t.wt)).toEqual({ branch: "feature", remote: "origin" });
    expect(await sh(t.origin, "rev-parse", "feature")).toBe(sha);
    expect(await t.git.status(t.wt)).toMatchObject({ upstream: "origin/feature", ahead: 0, behind: 0 });
  });

  it("refuses to push without a remote", async () => {
    const t = await setup();
    await expect(t.git.push(t.wt)).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("merges into the base checkout, and aborts a conflicting merge", async () => {
    const t = await setup();
    writeFileSync(join(t.wt.path, "a.txt"), "a\n");
    await t.git.commit(t.wt, "Add a", true);
    const { sha } = await t.git.mergeToBase(t.wt, t.repo);
    expect(await sh(t.repo, "rev-parse", "HEAD")).toBe(sha);
    expect(readFileSync(join(t.repo, "a.txt"), "utf8")).toBe("a\n");

    writeFileSync(join(t.wt.path, "README.md"), "from feature\n");
    await t.git.commit(t.wt, "Feature edit", true);
    writeFileSync(join(t.repo, "README.md"), "from main\n");
    await sh(t.repo, "commit", "-q", "-am", "Main edit");
    await expect(t.git.mergeToBase(t.wt, t.repo)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await sh(t.repo, "status", "--porcelain")).toBe("");
  });

  it("refuses to merge into a base checkout with local changes", async () => {
    const t = await setup();
    writeFileSync(join(t.repo, "README.md"), "dirty\n");
    await expect(t.git.mergeToBase(t.wt, t.repo)).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
