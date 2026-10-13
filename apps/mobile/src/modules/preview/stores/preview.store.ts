import type { TDaemonEvent } from "@agentdeck/protocol";
import { create } from "zustand";

export type TPreviewStatus = Extract<TDaemonEvent, { type: "preview.status" }>["status"];
export type TPreviewWidth = "phone" | "tablet" | "full";

/** An open preview: its URL, the one-time key until the first load used it, and how it's shown. */
export type TOpenPreview = {
  url: string;
  key: string | null;
  /** Bumped by Reload: the frame remounts. */
  loads: number;
  width: TPreviewWidth;
};

type TPreviewState = {
  open: Record<string, TOpenPreview>;
  status: Record<string, TPreviewStatus>;
  opened: (id: string, url: string, key: string | null) => void;
  /** The first load spent the key; later loads use the cookie it set. */
  loaded: (id: string) => void;
  reload: (id: string) => void;
  setWidth: (id: string, width: TPreviewWidth) => void;
  setStatus: (id: string, status: TPreviewStatus) => void;
  closed: (id: string) => void;
};

export const previewId = (hostId: string, worktreeId: string): string => `${hostId}:${worktreeId}`;

/** Previews this device opened, per host and worktree. */
export const usePreviewStore = create<TPreviewState>()((set) => {
  const patch = (id: string, f: (p: TOpenPreview) => Partial<TOpenPreview>): void => {
    set((s) => {
      const p = s.open[id];
      return p ? { open: { ...s.open, [id]: { ...p, ...f(p) } } } : s;
    });
  };
  return {
    open: {},
    status: {},
    opened: (id, url, key) => {
      set((s) => ({
        open: { ...s.open, [id]: { url, key, loads: 0, width: s.open[id]?.width ?? "full" } },
      }));
    },
    loaded: (id) => {
      patch(id, (p) => (p.key === null ? {} : { key: null }));
    },
    reload: (id) => {
      patch(id, (p) => ({ loads: p.loads + 1 }));
    },
    setWidth: (id, width) => {
      patch(id, () => ({ width }));
    },
    setStatus: (id, status) => {
      set((s) => ({ status: { ...s.status, [id]: status } }));
    },
    closed: (id) => {
      set((s) => {
        const { [id]: _gone, ...rest } = s.open;
        return { open: rest };
      });
    },
  };
});

/** What the frame loads: the key on the first load only. */
export function frameUrl(p: TOpenPreview): string {
  if (p.key === null) return p.url;
  const u = new URL(p.url);
  u.searchParams.set("k", p.key);
  return u.toString();
}
