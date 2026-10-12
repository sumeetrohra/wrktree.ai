export const chatsKeys = {
  all: ["chats"] as const,
  list: (worktreeId: string) => ["chats", worktreeId] as const,
};
