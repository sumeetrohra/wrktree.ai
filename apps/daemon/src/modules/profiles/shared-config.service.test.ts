import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { TAgentSpec } from "#src/shared/agent-spec.types.js";

import { PROFILE_MCP, SharedConfig } from "./shared-config.service.js";

const spec = (instructions: string, skills?: string): TAgentSpec => ({
  id: "x",
  displayName: "X",
  command: [],
  profileEnv: () => ({}),
  loginCommand: [],
  loginStatus: () => ({ loggedIn: true }),
  sharedFiles: skills === undefined ? { instructions } : { instructions, skills },
  detectLimit: () => ({ hit: false }),
  detectReplyLimit: () => ({ hit: false }),
});
const CLAUDE = spec("CLAUDE.md", "skills");
const CODEX = spec("AGENTS.md");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "shared-"));
  const shared = new SharedConfig(join(root, "shared"));
  const profile = (name: string): string => {
    const dir = join(root, "profiles", name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  return { root, shared, profile };
}

describe("SharedConfig", () => {
  it("links the instructions under each agent's own name, and skills where the agent has them", () => {
    const t = setup();
    t.shared.set({ instructions: "Use pnpm.\n" });
    mkdirSync(join(t.root, "shared", "skills", "release-notes"), { recursive: true });
    const claude = t.profile("claude");
    const codex = t.profile("codex");
    t.shared.linkInto(claude, CLAUDE);
    t.shared.linkInto(codex, CODEX);
    expect(readFileSync(join(claude, "CLAUDE.md"), "utf8")).toBe("Use pnpm.\n");
    expect(readFileSync(join(codex, "AGENTS.md"), "utf8")).toBe("Use pnpm.\n");
    expect(existsSync(join(claude, "skills", "release-notes"))).toBe(true);
    expect(existsSync(join(codex, "skills"))).toBe(false);
    expect(t.shared.get()).toEqual({
      instructions: "Use pnpm.\n",
      mcpServers: [],
      skills: ["release-notes"],
    });
  });

  it("follows edits: linked (or re-copied on Windows) on every sync", () => {
    const t = setup();
    const dir = t.profile("claude");
    t.shared.set({ instructions: "one\n" });
    t.shared.linkInto(dir, CLAUDE);
    t.shared.set({ instructions: "two\n" });
    t.shared.linkInto(dir, CLAUDE);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("two\n");
    expect(t.shared.overrides(dir, CLAUDE)).toEqual([]);
  });

  it("leaves a profile's own file alone (an override) until it is removed", () => {
    const t = setup();
    const dir = t.profile("claude");
    t.shared.set({ instructions: "shared\n" });
    writeFileSync(join(dir, "CLAUDE.md"), "mine\n");
    t.shared.linkInto(dir, CLAUDE);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("mine\n");
    expect(t.shared.overrides(dir, CLAUDE)).toEqual(["CLAUDE.md"]);
    t.shared.removeOverride(dir, CLAUDE, "CLAUDE.md");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("shared\n");
    expect(() => {
      t.shared.removeOverride(dir, CLAUDE, "credentials.json");
    }).toThrow(/not an override/);
  });

  it("a file the user put where the link was is theirs from then on", () => {
    const t = setup();
    const dir = t.profile("claude");
    t.shared.set({ instructions: "shared\n" });
    t.shared.linkInto(dir, CLAUDE);
    rmSync(join(dir, "CLAUDE.md"));
    writeFileSync(join(dir, "CLAUDE.md"), "mine\n");
    t.shared.set({ instructions: "shared, edited\n" });
    t.shared.linkInto(dir, CLAUDE);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("mine\n");
    expect(t.shared.overrides(dir, CLAUDE)).toEqual(["CLAUDE.md"]);
  });

  it("treats links made before the manifest existed as its own", () => {
    if (process.platform === "win32") return; // links are junctions or copies there
    const t = setup();
    const dir = t.profile("claude");
    t.shared.set({ instructions: "x\n" });
    writeFileSync(join(t.root, "shared", "notes.txt"), "n\n");
    symlinkSync(join(t.root, "shared", "notes.txt"), join(dir, "notes.txt"));
    expect(t.shared.overrides(dir, CLAUDE)).toEqual([]);
    t.shared.linkInto(dir, CLAUDE);
    expect(lstatSync(join(dir, "notes.txt")).isSymbolicLink()).toBe(true);
  });

  it("merges MCP servers: the profile's own win by name", () => {
    const t = setup();
    const dir = t.profile("claude");
    t.shared.set({
      mcpServers: [
        { type: "stdio", name: "github", command: "gh-mcp", args: [], env: {} },
        { type: "http", name: "docs", url: "https://mcp.example.com/", headers: {} },
      ],
    });
    writeFileSync(
      join(dir, PROFILE_MCP),
      JSON.stringify({
        servers: [{ type: "stdio", name: "github", command: "gh-mcp-work", args: ["--org", "acme"] }],
      }),
    );
    expect(t.shared.mcpServersFor(dir)).toEqual([
      { type: "stdio", name: "github", command: "gh-mcp-work", args: ["--org", "acme"], env: {} },
      { type: "http", name: "docs", url: "https://mcp.example.com/", headers: {} },
    ]);
    expect(t.shared.overrides(dir, CLAUDE)).toEqual([PROFILE_MCP]);
    expect(() => {
      t.shared.set({
        mcpServers: [
          { type: "stdio", name: "a", command: "x", args: [], env: {} },
          { type: "stdio", name: "a", command: "y", args: [], env: {} },
        ],
      });
    }).toThrow(/unique/);
  });
});
