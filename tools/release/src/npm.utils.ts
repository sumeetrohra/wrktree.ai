import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** npm's own script next to this Node (no shell needed, on Windows either). */
function npmCli(): string {
  const base = dirname(process.execPath);
  const candidates = [
    join(base, "node_modules", "npm", "bin", "npm-cli.js"),
    join(base, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found === undefined) throw new Error(`npm not found next to ${process.execPath}`);
  return found;
}

/** Runs npm with these arguments in `cwd`, returning its stdout (throws on failure). */
export function npm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(process.execPath, [npmCli(), ...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** Runs Node on a script and returns its stdout. */
export function node(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(process.execPath, [...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** Runs a command (`[program, ...args]`, no shell) with more arguments and returns its stdout. */
export function run(
  command: readonly string[],
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const [program = "", ...pre] = command;
  return execFileSync(program, [...pre, ...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
