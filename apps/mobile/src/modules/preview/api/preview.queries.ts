import { daemonCall, onDaemonEvent } from "@/lib/api";

import { previewId, usePreviewStore } from "../stores/preview.store";

/** Starts the worktree's preview script and opens a URL to it for this device. */
export async function startPreview(hostId: string, worktreeId: string): Promise<void> {
  const { url, key } = await daemonCall(hostId, "preview.start", { worktreeId });
  usePreviewStore.getState().opened(previewId(hostId, worktreeId), url, key);
}

export async function stopPreview(hostId: string, worktreeId: string): Promise<void> {
  await daemonCall(hostId, "preview.stop", { worktreeId });
  usePreviewStore.getState().closed(previewId(hostId, worktreeId));
}

/** `preview.status` events keep each preview's state current. Call once at startup. */
export function startPreviewSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    if (e.type !== "preview.status") return;
    const id = previewId(hostId, e.worktreeId);
    usePreviewStore.getState().setStatus(id, e.status);
    if (e.status === "stopped") usePreviewStore.getState().closed(id);
  });
}
