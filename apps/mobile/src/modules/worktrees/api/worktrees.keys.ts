export const worktreesKeys = {
  all: ["worktrees"] as const,
  list: (repoId: string) => ["worktrees", repoId] as const,
};
