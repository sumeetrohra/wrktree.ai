import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_GH_LOGGED_OUT_FILE, fakeGhEntry } from "@agentdeck/fake-gh";
import type { TWorktree } from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { git } from "#src/infra/process/index.js";

import { GithubService } from "./github.service.js";

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await git(cwd, args)).trim();

/** A clone of a bare origin, on a pushed branch `feature` with one commit. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "gh-svc-"));
  const origin = join(root, "origin.git");
  await sh(root, "init", "-q", "--bare", "-b", "main", origin);
  const path = join(root, "repo");
  await sh(root, "init", "-q", "-b", "main", path);
  await sh(path, "config", "user.email", "t@agentdeck.dev");
  await sh(path, "config", "user.name", "T");
  writeFileSync(join(path, "README.md"), "hello\n");
  await sh(path, "add", "-A");
  await sh(path, "commit", "-q", "-m", "Initial commit");
  await sh(path, "remote", "add", "origin", origin);
  await sh(path, "push", "-q", "origin", "main");
  await sh(path, "checkout", "-q", "-b", "feature");
  writeFileSync(join(path, "a.txt"), "a\n");
  await sh(path, "add", "-A");
  await sh(path, "commit", "-q", "-m", "Add a");
  await sh(path, "push", "-q", "-u", "origin", "feature");
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
  return { wt, origin, gh: new GithubService({ bin: fakeGhEntry, env: {} }) };
}

describe("GithubService (against fake-gh)", () => {
  it("has no PR, creates one with the body from stdin, then merges it", async () => {
    const t = await setup();
    expect(await t.gh.status(t.wt)).toBeNull();
    const pr = await t.gh.create(t.wt, "Add a", "Adds `a.txt`.\n\n$(not run)", true);
    expect(pr).toMatchObject({ number: 1, state: "open", draft: true });
    expect(pr.url).toMatch(/\/pull\/1$/);
    await expect(t.gh.merge(t.wt, "squash")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("merges a ready PR into origin's main", async () => {
    const t = await setup();
    await t.gh.create(t.wt, "Add a", "body");
    const merged = await t.gh.merge(t.wt, "merge");
    expect(merged.state).toBe("merged");
    expect(await sh(t.origin, "show", "main:a.txt")).toBe("a");
  });

  it("reports a missing or signed-out gh as NOT_AUTHENTICATED", async () => {
    const t = await setup();
    writeFileSync(join(t.wt.path, ".git", FAKE_GH_LOGGED_OUT_FILE), "");
    await expect(t.gh.status(t.wt)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
    const missing = new GithubService({ bin: join(tmpdir(), "no-such-gh"), env: {} });
    await expect(missing.status(t.wt)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});
