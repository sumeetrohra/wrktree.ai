/** Query keys for this module (D6). Every daemon query is per host. */
export const reposKeys = {
  all: ["repos"] as const,
  list: (hostId: string) => [...reposKeys.all, hostId] as const,
};
