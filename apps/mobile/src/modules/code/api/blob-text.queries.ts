import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

import { decodeBase64Utf8 } from "../utils/text.utils";

/** A text blob from a host (a diff, a log), decoded. Blobs are content-addressed, so never stale. */
export function useBlobTextQuery(hostId: string, blobId: string | undefined): UseQueryResult<string> {
  return useQuery({
    queryKey: ["blobText", hostId, blobId],
    queryFn: async () => {
      if (blobId === undefined) throw new Error("no blob");
      const { base64 } = await daemonCall(hostId, "blob.get", { blobId });
      return decodeBase64Utf8(base64);
    },
    enabled: blobId !== undefined,
    staleTime: Infinity,
  });
}
