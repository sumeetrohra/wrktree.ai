/** Query keys for this module (D6). */
export const reposKeys = {
  all: ["repos"] as const,
  list: () => [...reposKeys.all, "list"] as const,
};
