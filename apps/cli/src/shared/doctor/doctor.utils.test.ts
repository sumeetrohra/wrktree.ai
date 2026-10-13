import { describe, expect, it } from "vitest";

import { redact, runChecks, type IDoctorProbe } from "./doctor.utils.js";

function fakeProbe(over: Partial<IDoctorProbe> & { installed?: string[] } = {}): IDoctorProbe {
  const installed = over.installed ?? ["git", "gh", "npx", "gemini", "ffmpeg"];
  return {
    platform: "linux",
    nodeVersion: "v22.12.0",
    run: (cmd) => {
      const bin = (cmd[0] ?? "").replace(".cmd", "");
      if (!installed.includes(bin)) return Promise.resolve({ code: 127, stdout: "", stderr: "" });
      if (bin === "gh" && cmd[1] === "auth")
        return Promise.resolve({ code: 0, stdout: "", stderr: "Logged in" });
      if (bin === "git" && cmd[1] === "config") return Promise.resolve({ code: 1, stdout: "", stderr: "" });
      return Promise.resolve({ code: 0, stdout: `${bin} version 1.0\n`, stderr: "" });
    },
    daemonRunning: () => Promise.resolve(true),
    relayUrl: () => Promise.resolve("https://relay.example.com"),
    reachable: () => Promise.resolve(true),
    portInUse: () => Promise.resolve(false),
    terminal: () => Promise.resolve(true),
    ...over,
  };
}

const byName = (checks: Awaited<ReturnType<typeof runChecks>>) =>
  Object.fromEntries(checks.map((c) => [c.name, c.status]));

describe("runChecks", () => {
  it("all good on a set-up machine", async () => {
    const checks = await runChecks(fakeProbe());
    expect(checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("flags what's missing, with a fix for each", async () => {
    const checks = await runChecks(
      fakeProbe({
        nodeVersion: "v20.11.1",
        installed: ["npx"],
        daemonRunning: () => Promise.resolve(false),
        reachable: () => Promise.resolve(false),
        portInUse: () => Promise.resolve(true),
        terminal: () => Promise.resolve(false),
      }),
    );
    expect(byName(checks)).toMatchObject({
      "Node.js": "fail",
      git: "fail",
      "GitHub CLI": "warn",
      "Gemini CLI": "warn",
      Daemon: "fail",
      Relay: "fail",
      "Worktree ports": "warn",
      Terminal: "warn",
      ffmpeg: "warn",
    });
    for (const c of checks.filter((x) => x.status !== "ok")) expect(c.fix).toBeTruthy();
  });

  it("on Windows, checks git long paths; without a relay, says so", async () => {
    const checks = await runChecks(fakeProbe({ platform: "win32", relayUrl: () => Promise.resolve(null) }));
    expect(byName(checks)).toMatchObject({ "git long paths": "warn", Relay: "warn" });
  });
});

describe("redact", () => {
  it("removes tokens, keys and emails from logs", () => {
    const log =
      '{"msg":"signed in","email":"me@example.com","deviceToken":"abc.def","idToken":"x"} Authorization: Bearer eyJhbGc.xyz sk_live_1234567890 ghp_abcdefghijklmnop';
    const out = redact(log);
    expect(out).not.toMatch(/me@example\.com|abc\.def|eyJhbGc|sk_live|ghp_/);
    expect(out).toContain('"deviceToken":"[redacted]"');
    expect(out).toContain("Bearer [redacted]");
  });
});
