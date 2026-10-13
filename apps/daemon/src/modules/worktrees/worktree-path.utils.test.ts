import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { longPathArgs, worktreePath } from "./worktree-path.utils.js";

const repo = { id: "repo_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", path: join("/src", "shop") };

describe("worktreePath", () => {
  it("defaults to a folder next to the repo", () => {
    expect(worktreePath(repo, "feat/login", null)).toBe(
      join("/src", ".agentdeck-worktrees", "shop", "feat-login"),
    );
  });

  it("uses a short root when given, keeping same-named repos apart", () => {
    expect(worktreePath(repo, "fix", join("C:", "wt"))).toBe(join("C:", "wt", "shop-q0p9n8", "fix"));
    const other = { ...repo, id: "repo_01J9Z8Y7X6W5V4T3S2R1AAAAAA" };
    expect(worktreePath(other, "fix", join("C:", "wt"))).not.toBe(
      worktreePath(repo, "fix", join("C:", "wt")),
    );
  });
});

describe("longPathArgs", () => {
  it("turns on core.longpaths for git on Windows only", () => {
    expect(longPathArgs("win32")).toEqual(["-c", "core.longpaths=true"]);
    expect(longPathArgs("linux")).toEqual([]);
  });
});
