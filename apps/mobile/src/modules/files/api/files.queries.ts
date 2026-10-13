import type { TCommandResult, TFsEntry } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall } from "@/lib/api";

/** Files bigger than this open truncated: a phone doesn't need more to read code. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** The daemon's `fs.read` chunk. (A multi-byte character split across chunks shows as "?".) */
const CHUNK = 256 * 1024;

export function useTreeQuery(hostId: string, worktreeId: string, path: string): UseQueryResult<TFsEntry[]> {
  return useQuery({
    queryKey: ["fsTree", hostId, worktreeId, path],
    queryFn: async () => (await daemonCall(hostId, "fs.tree", { worktreeId, path })).entries,
  });
}

/** ripgrep across the worktree (two characters or more). */
export function useSearchQuery(
  hostId: string,
  worktreeId: string,
  query: string,
): UseQueryResult<TCommandResult<"fs.search">> {
  return useQuery({
    queryKey: ["fsSearch", hostId, worktreeId, query],
    queryFn: () => daemonCall(hostId, "fs.search", { worktreeId, query }),
    enabled: query.trim().length >= 2,
  });
}

/** A file's text, read in chunks (`fs.read`), up to 2 MB. */
export function useFileTextQuery(
  hostId: string,
  worktreeId: string,
  path: string,
): UseQueryResult<{ text: string; truncated: boolean }> {
  return useQuery({
    queryKey: ["fsRead", hostId, worktreeId, path],
    queryFn: async () => {
      let text = "";
      let offset = 0;
      for (;;) {
        const r = await daemonCall(hostId, "fs.read", { worktreeId, path, offset, length: CHUNK });
        text += r.text;
        offset = r.offset + Math.min(CHUNK, r.size - r.offset);
        if (r.eof) return { text, truncated: false };
        if (offset >= MAX_FILE_BYTES) return { text, truncated: true };
      }
    },
  });
}
