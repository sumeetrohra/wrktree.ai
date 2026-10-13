import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultShell, ptyAvailable, spawnPty } from "./pty.service.js";

describe("spawnPty", () => {
  it("runs a shell on a pseudo-terminal and reports its exit", async () => {
    expect(await ptyAvailable()).toBe(true);
    const cwd = mkdtempSync(join(tmpdir(), "pty-"));
    const env = Object.fromEntries(
      Object.entries(process.env).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])),
    );
    const p = await spawnPty(defaultShell(env), { cwd, env, cols: 80, rows: 24 });
    let out = "";
    p.onData((d) => {
      out += d;
    });
    const exited = new Promise<number>((resolve) => {
      p.onExit(resolve);
    });
    p.resize(100, 30);
    // The sum proves the shell ran it (the echoed command line alone doesn't contain "pty-42").
    p.write(process.platform === "win32" ? 'Write-Output ("pty-" + (40+2))\r' : "echo pty-$((40+2))\r");
    for (let i = 0; i < 400 && !out.includes("pty-42"); i++) await new Promise((r) => setTimeout(r, 50));
    expect(out).toContain("pty-42");
    p.write("exit\r");
    expect(await exited).toBe(0);
    // PowerShell takes seconds to start on a Windows runner.
  }, 30_000);
});
