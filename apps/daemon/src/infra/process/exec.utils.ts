import { execFile, spawn, type ChildProcess } from "node:child_process";

import { AgentdeckError } from "@agentdeck/protocol";

import { childEnv } from "./child-env.utils.js";

export type TExecResult = { stdout: string; stderr: string; code: number };

/** Runs a program without a shell. Never throws on a non-zero exit; callers check `code`. */
export function run(
  file: string,
  args: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<TExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, env: opts.env ?? childEnv(), maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr, code: 0 });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ stdout, stderr, code: error.code });
          return;
        }
        reject(new Error(error.message, { cause: error }));
      },
    );
  });
}

/** `git …` in `cwd`; throws GIT_FAILED with stderr on a non-zero exit unless `allow` lists the code. */
export async function git(
  cwd: string,
  args: readonly string[],
  allow: readonly number[] = [],
): Promise<string> {
  const r = await run("git", args, { cwd });
  if (r.code !== 0 && !allow.includes(r.code)) {
    throw new AgentdeckError(
      "GIT_FAILED",
      `git ${args[0] ?? ""} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      false,
      {
        exitCode: r.code,
      },
    );
  }
  return r.stdout;
}

/**
 * Runs a repo's setup or teardown script through the platform shell, in its own process group
 * (Unix) so `killTree` takes down everything it started. The only place a shell is used.
 */
export function spawnShell(
  command: string,
  opts: { cwd: string; env: Record<string, string> },
): ChildProcess {
  return spawn(command, {
    cwd: opts.cwd,
    env: opts.env,
    // eslint-disable-next-line no-restricted-syntax -- reason: repo setup scripts are shell command lines by design (SEC7)
    shell: true,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Spawns a program (no shell) with piped stdio, e.g. an ACP adapter. */
export function spawnPiped(
  command: readonly string[],
  opts: { cwd: string; env: Record<string, string> },
): ChildProcess {
  const [file, ...args] = command;
  if (file === undefined) throw new AgentdeckError("INVALID_ARGS", "Empty command");
  return spawn(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // npx and friends are .cmd shims on Windows and need the shell to run.
    shell: process.platform === "win32" && file.endsWith(".cmd"),
  });
}

export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}
