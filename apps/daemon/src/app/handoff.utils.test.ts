import { describe, expect, it } from "vitest";

import { handoffBrief, type THandoffBriefInput } from "./handoff.utils.js";

const base: THandoffBriefInput = {
  title: "Fix the login redirect",
  transcript: [
    { role: "User", text: "Fix the login redirect" },
    { role: "Agent", text: "Looking at src/auth.ts" },
  ],
  plan: [
    { text: "Find the redirect", status: "done" },
    { text: "Write a test", status: "pending" },
  ],
  pending: ["Edit src/auth.ts"],
  unanswered: "Also handle the logout page",
  from: { agent: "claude", profile: "Work", limited: true },
  diff: {
    against: "main",
    files: [
      { path: "src/auth.ts", status: "modified", added: 3, removed: 1 },
      { path: "logo.png", status: "binary", added: 0, removed: 0 },
    ],
  },
  unsent: ["And run the tests"],
};

describe("handoffBrief", () => {
  it("carries the conversation, plan, changes, pending approval and what's next", () => {
    const brief = handoffBrief(base);
    expect(brief).toContain('from claude (profile "Work") in this same worktree; it reached its usage limit');
    expect(brief).toContain("Task: Fix the login redirect");
    expect(brief).toContain(
      "## Conversation so far\n\nUser: Fix the login redirect\n\nAgent: Looking at src/auth.ts",
    );
    expect(brief).toContain("- [done] Find the redirect\n- [pending] Write a test");
    expect(brief).toContain("- modified src/auth.ts (+3 -1)\n- binary logo.png (binary)");
    expect(brief).toContain("## It was waiting for approval to\n\n- Edit src/auth.ts");
    expect(brief).toMatch(/## What the user wants next\n\nAlso handle the logout page\n\nAnd run the tests$/);
  });

  it("leaves out what it doesn't have, and asks to carry on", () => {
    const brief = handoffBrief({
      ...base,
      title: null,
      transcript: [],
      plan: [],
      pending: [],
      unanswered: null,
      unsent: [],
      diff: null,
      from: { agent: "codex", profile: "Personal", limited: false },
    });
    expect(brief).toContain("the user moved the work");
    expect(brief).not.toContain("## Conversation");
    expect(brief).not.toContain("## Changes");
    expect(brief).toContain("Continue the task; say briefly what you will do first.");
  });

  it("lists at most 50 changed files", () => {
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `f${String(i)}.ts`,
      status: "added" as const,
      added: 1,
      removed: 0,
    }));
    expect(handoffBrief({ ...base, diff: { against: "main", files } })).toContain("- … and 10 more files");
  });
});
