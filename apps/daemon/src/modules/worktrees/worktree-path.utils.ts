import { basename, dirname, join } from "node:path";

/**
 * Where a new worktree goes (Phase 4d): next to its repo by default, or under `root` (on Windows
 * a short folder, so deep node_modules paths stay under 260 characters). The repo id keeps two
 * repos with the same folder name apart.
 */
export function worktreePath(
  repo: { id: string; path: string },
  branch: string,
  root: string | null,
): string {
  const leaf = branch.replace(/[\\/]/g, "-");
  if (root === null) return join(dirname(repo.path), ".agentdeck-worktrees", basename(repo.path), leaf);
  return join(root, `${basename(repo.path)}-${repo.id.slice(-6).toLowerCase()}`, leaf);
}

/** Git arguments that let a worktree hold paths longer than 260 characters on Windows. */
export function longPathArgs(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["-c", "core.longpaths=true"] : [];
}
