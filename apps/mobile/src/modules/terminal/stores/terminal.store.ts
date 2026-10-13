import { create } from "zustand";

import type { TTerminalFeed } from "@/lib/terminal";

/** Scrollback kept per terminal on this device (the host keeps its own). */
const KEEP_CHARS = 256 * 1024;

type TTerminalState = {
  /** Which terminal each worktree shows, by `hostId:worktreeId`. */
  current: Record<string, string>;
  show: (hostId: string, worktreeId: string, termId: string | null) => void;
};

/** The terminal each worktree's tab shows. */
export const useTerminalStore = create<TTerminalState>()((set) => ({
  current: {},
  show: (hostId, worktreeId, termId) => {
    set((s) => {
      const key = `${hostId}:${worktreeId}`;
      const { [key]: _, ...rest } = s.current;
      return { current: termId === null ? rest : { ...rest, [key]: termId } };
    });
  },
}));

type TBuffer = { text: string; cursor: number; listeners: Set<(data: string) => void> };

/**
 * Output is written straight into the terminal view, not rendered by React: this keeps each
 * terminal's text and cursor, and the views listening to it.
 */
const buffers = new Map<string, TBuffer>();

function buffer(termId: string): TBuffer {
  let b = buffers.get(termId);
  if (b === undefined) {
    b = { text: "", cursor: 0, listeners: new Set() };
    buffers.set(termId, b);
  }
  return b;
}

/** The scrollback from `term.output`, covering events up to `cursor`. */
export function resetOutput(termId: string, text: string, cursor: number): void {
  const b = buffer(termId);
  b.text = text.slice(-KEEP_CHARS);
  b.cursor = cursor;
}

/** A live `term.output` event; ones the scrollback already covers are ignored. */
export function appendOutput(termId: string, cursor: number, data: string): void {
  const b = buffer(termId);
  if (cursor <= b.cursor) return;
  b.cursor = cursor;
  b.text = (b.text + data).slice(-KEEP_CHARS);
  for (const l of b.listeners) l(data);
}

/** What a terminal view needs: the text so far, then each new chunk. */
export function terminalFeed(termId: string): TTerminalFeed {
  const b = buffer(termId);
  return {
    initial: b.text,
    subscribe: (write) => {
      b.listeners.add(write);
      return () => {
        b.listeners.delete(write);
      };
    },
  };
}
