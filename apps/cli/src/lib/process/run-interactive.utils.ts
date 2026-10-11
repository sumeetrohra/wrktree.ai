import { spawn } from "node:child_process";

/** Runs a program attached to this terminal (e.g. an agent's login flow) and resolves its exit code. */
export function runInteractive(command: readonly string[], env: Record<string, string>): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) return Promise.resolve(127);
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: "inherit", env: { ...process.env, ...env } });
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
    child.on("error", () => {
      resolve(127);
    });
  });
}
