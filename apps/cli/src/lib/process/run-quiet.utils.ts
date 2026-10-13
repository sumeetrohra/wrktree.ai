import { execFile } from "node:child_process";

/** Runs a program without a shell and returns its exit code and stderr (for service managers). */
export async function runQuiet(command: readonly string[]): Promise<{ code: number; stderr: string }> {
  const { code, stderr } = await runCapture(command);
  return { code, stderr };
}

/**
 * Runs a program without a shell and captures its output (10 s at most). A missing program is
 * code 127, like a shell would say.
 */
export function runCapture(
  command: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const [file, ...args] = command;
  if (file === undefined) return Promise.resolve({ code: 127, stdout: "", stderr: "empty command" });
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        {
          windowsHide: true,
          timeout: 10_000,
          // npx and friends are .cmd shims on Windows and only run through the shell (fixed
          // arguments from our own checks, never user input).
          shell: process.platform === "win32" && file.endsWith(".cmd"),
        },
        (error, stdout, stderr) => {
          const code = !error
            ? 0
            : error.code === "ENOENT"
              ? 127
              : typeof error.code === "number"
                ? error.code
                : 1;
          resolve({ code, stdout, stderr });
        },
      );
    } catch (e) {
      // Spawning itself failed (e.g. EINVAL): report it like a failed run.
      resolve({ code: 1, stdout: "", stderr: e instanceof Error ? e.message : String(e) });
    }
  });
}
