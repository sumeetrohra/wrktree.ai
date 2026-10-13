import type { TGitStatus, TPullRequest } from "@agentdeck/protocol";
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, queryClient } from "@/lib/api";

const statusKey = (hostId: string, worktreeId: string) => ["gitStatus", hostId, worktreeId] as const;
const prKey = (hostId: string, worktreeId: string) => ["prStatus", hostId, worktreeId] as const;

export function useGitStatusQuery(hostId: string, worktreeId: string): UseQueryResult<TGitStatus> {
  return useQuery({
    queryKey: statusKey(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "git.status", { worktreeId }),
  });
}

/** The branch's PR through `gh` on the computer; a missing or signed-out `gh` is an error. */
export function usePrStatusQuery(
  hostId: string,
  worktreeId: string,
  enabled: boolean,
): UseQueryResult<TPullRequest | null> {
  return useQuery({
    queryKey: prKey(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "pr.status", { worktreeId }),
    enabled,
    retry: false,
  });
}

function refresh(hostId: string, worktreeId: string): Promise<void> {
  return queryClient
    .invalidateQueries({ queryKey: ["gitStatus", hostId, worktreeId] })
    .then(() => queryClient.invalidateQueries({ queryKey: ["diffSummary", hostId, worktreeId] }));
}

export type TShipAction =
  | { kind: "commit"; message: string }
  | { kind: "push" }
  | { kind: "mergeToBase" }
  | { kind: "createPr"; title: string; body: string; draft: boolean }
  | { kind: "mergePr"; method: "merge" | "squash" | "rebase" };

/** Every write the Ship sheet makes; each refreshes the status (and the PR) afterwards. */
export function useShipMutation(
  hostId: string,
  worktreeId: string,
): UseMutationResult<void, Error, TShipAction> {
  return useMutation({
    mutationFn: async (a) => {
      if (a.kind === "commit")
        await daemonCall(hostId, "git.commit", { worktreeId, message: a.message, all: true });
      if (a.kind === "push") await daemonCall(hostId, "git.push", { worktreeId });
      if (a.kind === "mergeToBase") await daemonCall(hostId, "worktree.mergeToBase", { worktreeId });
      if (a.kind === "createPr") {
        const pr = await daemonCall(hostId, "pr.create", {
          worktreeId,
          title: a.title,
          body: a.body,
          draft: a.draft,
        });
        queryClient.setQueryData(prKey(hostId, worktreeId), pr);
      }
      if (a.kind === "mergePr") {
        const pr = await daemonCall(hostId, "pr.merge", { worktreeId, method: a.method });
        queryClient.setQueryData(prKey(hostId, worktreeId), pr);
      }
    },
    onSettled: () => refresh(hostId, worktreeId),
  });
}

/** Asks the chat's agent for a PR title and body (resolves when its turn ends). */
export function useDraftPrMutation(
  hostId: string,
): UseMutationResult<{ title: string; body: string }, Error, string> {
  return useMutation({ mutationFn: (chatId) => daemonCall(hostId, "pr.draft", { chatId }) });
}
