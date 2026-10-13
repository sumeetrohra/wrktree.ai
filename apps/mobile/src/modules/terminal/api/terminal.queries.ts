import type { TCommandResult, TTerminal } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { appendOutput, resetOutput, useTerminalStore } from "../stores/terminal.store";
import { InputQueue } from "../utils/input-queue.utils";

const termsKey = (hostId: string, worktreeId: string) => ["terminals", hostId, worktreeId] as const;

/** The worktree's terminals, and whether this device may use them. */
export function useTerminalsQuery(
  hostId: string,
  worktreeId: string,
): UseQueryResult<TCommandResult<"term.list">> {
  return useQuery({
    queryKey: termsKey(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "term.list", { worktreeId }),
  });
}

/** Starts a shell in the worktree and shows it. */
export async function openTerminal(hostId: string, worktreeId: string): Promise<void> {
  const term = await daemonCall(hostId, "term.open", { worktreeId, cols: 80, rows: 24 });
  upsert(hostId, term);
  await followTerminal(hostId, term.id);
  useTerminalStore.getState().show(hostId, worktreeId, term.id);
}

export async function closeTerminal(hostId: string, term: TTerminal): Promise<void> {
  upsert(hostId, await daemonCall(hostId, "term.close", { termId: term.id }));
  useTerminalStore.getState().show(hostId, term.worktreeId, null);
}

const inputs = new Map<string, InputQueue>();

/** Keystrokes, in order and batched (see `InputQueue`). */
export function sendInput(hostId: string, termId: string, data: string): void {
  let q = inputs.get(termId);
  if (q === undefined) {
    q = new InputQueue((d) => daemonCall(hostId, "term.input", { termId, data: d }));
    inputs.set(termId, q);
  }
  q.push(data);
}

export function resizeTerminal(hostId: string, termId: string, cols: number, rows: number): void {
  daemonCall(hostId, "term.resize", { termId, cols, rows }).catch(() => undefined);
}

/** The scrollback now, then live output after that cursor. */
export async function followTerminal(hostId: string, termId: string): Promise<void> {
  const { blob, cursor } = await daemonCall(hostId, "term.output", { termId });
  const { base64 } = await daemonCall(hostId, "blob.get", { blobId: blob.blobId });
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  resetOutput(termId, new TextDecoder().decode(bytes), cursor);
  await daemonCall(hostId, "sync.hello", {
    deviceName: "agentdeck",
    appVersion: "0.1.0",
    cursors: { [`term:${termId}`]: cursor },
  });
}

function upsert(hostId: string, term: TTerminal): void {
  queryClient.setQueryData<TCommandResult<"term.list">>(termsKey(hostId, term.worktreeId), (v) =>
    v
      ? {
          ...v,
          terminals: v.terminals.some((t) => t.id === term.id)
            ? v.terminals.map((t) => (t.id === term.id ? term : t))
            : [...v.terminals, term],
        }
      : v,
  );
}

/** Output goes to the terminal views, status to the lists. Call once at startup. */
export function startTerminalSync(): void {
  onDaemonEvent((hostId, { event: e, cursor }) => {
    if (e.type === "term.output") appendOutput(e.termId, cursor, e.data);
    if (e.type === "term.status") upsert(hostId, e.terminal);
  });
}
