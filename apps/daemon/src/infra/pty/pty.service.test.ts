import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultShell, ptyAvailable, spawnPty } from "./pty.service.js";

/**
 * Windows runs this in cmd.exe: PowerShell's line editor, scripted through ConPTY on a CI runner,
 * never acts on Enter (PowerShell itself is checked by hand; docs/phase-5.md).
 */
const WIN = process.platform === "win32";
const PROMPT = WIN ? /[A-Z]:\\[^>\r\n]*>/ : /[$#%>] ?$/m;
/** A sum, so seeing the answer proves the shell ran it (its echo doesn't contain the answer). */
const SUM = WIN ? "set /a 6*7+1000\r" : "echo pty-$((40+2))\r";
const ANSWER = WIN ? "1042" : "pty-42";

const wait = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
};

describe("spawnPty", () => {
  it("runs a shell on a pseudo-terminal and reports its exit", async () => {
    expect(await ptyAvailable()).toBe(true);
    const cwd = mkdtempSync(join(tmpdir(), "pty-"));
    const env = Object.fromEntries(
      Object.entries(process.env).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])),
    );
    const p = await spawnPty(WIN ? "cmd.exe" : defaultShell(env), { cwd, env, cols: 80, rows: 24 });
    let out = "";
    p.onData((d) => {
      out += d;
    });
    const exited = new Promise<number>((resolve) => {
      p.onExit(resolve);
    });
    p.resize(100, 30);
    await wait(() => PROMPT.test(out));
    p.write(SUM);
    await wait(() => out.includes(ANSWER));
    expect(out).toContain(ANSWER);
    p.write("exit\r");
    expect(await exited).toBe(0);
  }, 30_000);

  it("picks the user's shell, or PowerShell on Windows", () => {
    const shell = defaultShell({ SHELL: "/no/such/shell" });
    if (WIN) expect(shell).toBe("powershell.exe");
    else expect(shell).toMatch(/\/bin\/(ba)?sh$/);
  });
});
