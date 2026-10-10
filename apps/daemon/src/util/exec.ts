import { execFile, spawn, type ChildProcess } from "node:child_process";
import { AgentdeckError } from "@agentdeck/protocol";

export type ExecResult = { stdout: string; stderr: string; code: number };

/** Runs a program without a shell. Never throws on a non-zero exit; callers check `code`. */
export function run(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, env: opts.env ?? process.env, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") return reject(error);
        resolve({ stdout, stderr, code: error ? (error.code as unknown as number) : 0 });
      },
    );
  });
}

/** `git …` in `cwd`; throws GIT_FAILED with stderr on a non-zero exit unless `allow` lists the code. */
export async function git(cwd: string, args: string[], allow: number[] = []): Promise<string> {
  const r = await run("git", args, { cwd });
  if (r.code !== 0 && !allow.includes(r.code)) {
    throw new AgentdeckError(
      "GIT_FAILED",
      `git ${args[0]} failed: ${r.stderr.trim() || r.stdout.trim()}`,
      false,
      {
        exitCode: r.code,
      },
    );
  }
  return r.stdout;
}

/**
 * Spawns `command` through the platform shell in its own process group (Unix)
 * so `killTree` takes down everything it started.
 */
export function spawnShell(command: string, opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  return spawn(command, {
    cwd: opts.cwd,
    env: opts.env,
    shell: true,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}
