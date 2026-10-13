import { silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { KeepAwake, keepAwakeCommand } from "./keep-awake.service.js";

describe("keepAwakeCommand", () => {
  it("has a helper per OS", () => {
    expect(keepAwakeCommand("darwin", 42)).toEqual(["caffeinate", "-i", "-w", "42"]);
    expect(keepAwakeCommand("linux", 42)?.slice(0, 2)).toEqual(["systemd-inhibit", "--what=idle:sleep"]);
    expect(keepAwakeCommand("win32", 42)?.at(-1)).toMatch(/SetThreadExecutionState\(0x80000001\)/);
    expect(keepAwakeCommand("aix", 42)).toBeNull();
  });
});

describe("KeepAwake", () => {
  it("runs one helper while needed and stops it after", async () => {
    const k = new KeepAwake([process.execPath, "-e", "setInterval(() => {}, 1000)"], silentLogger);
    k.set(true);
    k.set(true);
    expect(k.active).toBe(true);
    k.set(false);
    expect(k.active).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
  });

  it("gives up quietly when the helper is missing", async () => {
    const k = new KeepAwake(["agentdeck-no-such-helper"], silentLogger);
    k.set(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(k.active).toBe(false);
    k.set(true);
    expect(k.active).toBe(false);
  });
});
