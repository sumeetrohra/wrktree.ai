import { execFile } from "node:child_process";

/** Runs a program without a shell and returns its exit code and stderr (for service managers). */
export function runQuiet(command: readonly string[]): Promise<{ code: number; stderr: string }> {
  const [file, ...args] = command;
  if (file === undefined) return Promise.resolve({ code: 127, stderr: "empty command" });
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (error, _stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr });
    });
  });
}
