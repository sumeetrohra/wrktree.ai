import { newId } from "@agentdeck/shared";
import { Platform } from "react-native";

import { daemonCall, onDaemonEvent } from "@/lib/api";
import { startLocalServer } from "@/lib/localserver";

import { previewId, usePreviewStore } from "../stores/preview.store";
import { serveSealed, type ISealedBackend } from "../utils/sealed-proxy.utils";

/** The local server of each sealed preview this phone has open, by preview id. */
const servers = new Map<string, () => void>();

/** A sealed preview's requests and sockets, through the host's end-to-end encrypted channel. */
function sealedBackend(hostId: string, token: string): ISealedBackend {
  return {
    fetch: (req) => daemonCall(hostId, "preview.fetch", { token, ...req }),
    wsEvents: async (wsId, listener) => {
      const off = onDaemonEvent((h, { event: e }) => {
        if (h === hostId && e.type === "preview.ws" && e.wsId === wsId) listener(e);
      });
      await daemonCall(hostId, "sync.hello", {
        deviceName: "agentdeck",
        appVersion: "0.1.0",
        cursors: { [`preview:${wsId}`]: 0 },
      });
      return off;
    },
    wsOpen: async (wsId, path, headers) => {
      await daemonCall(hostId, "preview.wsOpen", { wsId, token, path, headers });
    },
    wsSend: (wsId, data, binary) => {
      daemonCall(hostId, "preview.wsSend", { wsId, data, binary }).catch(() => undefined);
    },
    wsClose: (wsId) => {
      daemonCall(hostId, "preview.wsClose", { wsId }).catch(() => undefined);
    },
  };
}

/**
 * Starts the worktree's preview script and opens it here. Phones keep it end to end encrypted
 * (Phase 5e): the page loads from a server in the app that fetches through sealed commands. The
 * web build can't listen on a port, so it uses the relay tunnel (TLS only, SEC23).
 */
export async function startPreview(hostId: string, worktreeId: string): Promise<void> {
  const id = previewId(hostId, worktreeId);
  if (Platform.OS === "web") {
    const { url, key } = await daemonCall(hostId, "preview.start", { worktreeId });
    usePreviewStore.getState().opened(id, url, key);
    return;
  }
  const { token } = await daemonCall(hostId, "preview.start", { worktreeId, mode: "sealed" });
  if (token === undefined) throw new Error("This computer's agentdeck is too old for a sealed preview");
  servers.get(id)?.();
  const backend = sealedBackend(hostId, token);
  const server = await startLocalServer((socket) => {
    serveSealed(socket, backend, () => newId("pws"));
  });
  servers.set(id, server.stop);
  usePreviewStore.getState().opened(id, `http://127.0.0.1:${String(server.port)}/`, null);
}

export async function stopPreview(hostId: string, worktreeId: string): Promise<void> {
  const id = previewId(hostId, worktreeId);
  await daemonCall(hostId, "preview.stop", { worktreeId });
  servers.get(id)?.();
  servers.delete(id);
  usePreviewStore.getState().closed(id);
}

/** `preview.status` events keep each preview's state current. Call once at startup. */
export function startPreviewSync(): void {
  onDaemonEvent((hostId, { event: e }) => {
    if (e.type !== "preview.status") return;
    const id = previewId(hostId, e.worktreeId);
    usePreviewStore.getState().setStatus(id, e.status);
    if (e.status === "stopped") {
      servers.get(id)?.();
      servers.delete(id);
      usePreviewStore.getState().closed(id);
    }
  });
}
