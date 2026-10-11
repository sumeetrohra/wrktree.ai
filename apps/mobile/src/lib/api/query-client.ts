import { QueryClient } from "@tanstack/react-query";

/** Shared React Query client: daemon (server) state lives here (D1). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});
