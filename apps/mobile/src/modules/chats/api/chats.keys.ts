export const chatsKeys = {
  all: ["chats"] as const,
  list: (hostId: string, worktreeId: string) => ["chats", hostId, worktreeId] as const,
};
