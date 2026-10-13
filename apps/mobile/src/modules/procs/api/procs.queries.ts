import type { TCommandResult, TProc } from "@agentdeck/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { daemonCall, onDaemonEvent, queryClient } from "@/lib/api";

import { useProcLogStore } from "../stores/proc-log.store";

const procsKey = (hostId: string, worktreeId: string) => ["procs", hostId, worktreeId] as const;

/** The repo's scripts and this worktree's processes. */
export function useProcsQuery(
  hostId: string,
  worktreeId: string,
): UseQueryResult<TCommandResult<"proc.list">> {
  return useQuery({
    queryKey: procsKey(hostId, worktreeId),
    queryFn: () => daemonCall(hostId, "proc.list", { worktreeId }),
  });
}

export async function startProc(hostId: string, worktreeId: string, script: string): Promise<TProc> {
  const proc = await daemonCall(hostId, "proc.start", { worktreeId, script });
  upsert(hostId, proc);
  await followProc(hostId, proc.id);
  return proc;
}

export async function stopProc(hostId: string, procId: string): Promise<void> {
  upsert(hostId, await daemonCall(hostId, "proc.stop", { procId }));
}

/**
 * Shows a process's output: the newest megabyte now, then live events after that cursor (the
 * host streams `proc:<id>` once this device subscribes to it).
 */
export async function followProc(hostId: string, procId: string): Promise<void> {
  const { blob, cursor } = await daemonCall(hostId, "proc.output", { procId });
  const { base64 } = await daemonCall(hostId, "blob.get", { blobId: blob.blobId });
  const bin = atob(base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  useProcLogStore.getState().reset(procId, new TextDecoder().decode(bytes), cursor);
  await daemonCall(hostId, "sync.hello", {
    deviceName: "agentdeck",
    appVersion: "0.1.0",
    cursors: { [`proc:${procId}`]: cursor },
  });
}

function upsert(hostId: string, proc: TProc): void {
  queryClient.setQueryData<TCommandResult<"proc.list">>(procsKey(hostId, proc.worktreeId), (v) =>
    v
      ? {
          ...v,
          procs: v.procs.some((p) => p.id === proc.id)
            ? v.procs.map((p) => (p.id === proc.id ? proc : p))
            : [...v.procs, proc],
        }
      : v,
  );
}

/** Output and status events update the log store and the process lists. Call once at startup. */
export function startProcsSync(): void {
  onDaemonEvent((hostId, { event: e, cursor }) => {
    if (e.type === "proc.output") useProcLogStore.getState().append(e.procId, cursor, e.chunk);
    if (e.type === "proc.status") upsert(hostId, e.proc);
  });
}
