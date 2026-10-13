import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runtimeDeps } from "./pack.service.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("runtimeDeps", () => {
  it("collects the npm dependencies of the CLI and every workspace package it pulls in", () => {
    const deps = runtimeDeps(ROOT, "apps/cli");
    expect(Object.keys(deps).some((d) => d.startsWith("@agentdeck/"))).toBe(false);
    // From the daemon (two levels down) and the crypto package (three).
    expect(deps).toHaveProperty("better-sqlite3");
    expect(deps).toHaveProperty("@vscode/ripgrep");
    expect(deps).toHaveProperty("@noble/hashes");
    expect(Object.keys(deps)).toEqual([...Object.keys(deps)].sort((a, b) => a.localeCompare(b)));
  });

  it("the relay doesn't pull in the daemon's", () => {
    const deps = runtimeDeps(ROOT, "apps/relay");
    expect(deps).toHaveProperty("hono");
    expect(deps).not.toHaveProperty("@vscode/ripgrep");
  });
});
