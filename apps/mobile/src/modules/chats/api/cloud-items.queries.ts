import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { cloud, type TCloudItem } from "@/lib/cloud";

/** A chat's history from the cloud (when its computer is offline or its worktree is gone). */
export function useCloudItemsQuery(chatId: string, enabled: boolean): UseQueryResult<TCloudItem[]> {
  return useQuery({
    queryKey: ["cloud-items", chatId],
    queryFn: () => cloud.items(chatId),
    enabled: enabled && cloud.available(),
  });
}

/** An image stored in the cloud, as a URI an `Image` can show. */
export function useCloudFileQuery(storagePath: string, mime: string): UseQueryResult<string> {
  return useQuery({
    queryKey: ["cloud-file", storagePath],
    queryFn: () => cloud.fileUri(storagePath, mime),
    staleTime: Infinity,
  });
}
