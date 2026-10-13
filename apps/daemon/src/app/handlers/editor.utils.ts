import { AgentdeckError } from "@agentdeck/protocol";

const CLI = { vscode: "code", cursor: "cursor", zed: "zed" } as const;

/**
 * How to open a worktree (at a file and line) in a desktop editor. macOS and Linux use the editor's
 * command-line launcher; Windows hands the editor's URL (`vscode://file/…`) to the shell's URL
 * handler, because the launchers there are `.cmd` scripts that would need a shell.
 */
export function editorCommand(
  editor: keyof typeof CLI,
  folder: string,
  file: string | null,
  line: number | undefined,
  platform: NodeJS.Platform,
): string[] {
  const at = file && line ? `${file}:${String(line)}` : file;
  if (platform === "win32") {
    const target = (at ?? folder).replace(/\\/g, "/");
    const url = `${editor}://file/${encodeURI(target)}`;
    return ["rundll32", "url.dll,FileProtocolHandler", url];
  }
  const cli = CLI[editor];
  if (editor === "zed") return [cli, folder, ...(at ? [at] : [])];
  if (at === null) return [cli, folder];
  if (at.startsWith("-")) throw new AgentdeckError("INVALID_ARGS", "Bad path");
  return [cli, folder, "--goto", at];
}
