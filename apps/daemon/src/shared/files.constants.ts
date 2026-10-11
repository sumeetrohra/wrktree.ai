/** Secret globs hidden from clients and agents in every worktree (SEC2). Repos can add more. */
export const DEFAULT_HIDDEN_GLOBS: readonly string[] = [".env*", "*.pem", "*.key"];
