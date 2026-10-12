export const worktreesKeys = {
  all: ["worktrees"] as const,
  host: (hostId: string) => ["worktrees", hostId] as const,
  list: (hostId: string, repoId: string) => ["worktrees", hostId, repoId] as const,
};
