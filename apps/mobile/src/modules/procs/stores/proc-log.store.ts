import { create } from "zustand";

import { stripAnsi } from "../utils/ansi.utils";

/** What a log view keeps per process; older text scrolls off (the host keeps the last megabyte). */
const KEEP_CHARS = 256 * 1024;

type TLog = { text: string; cursor: number };

type TProcLogState = {
  logs: Record<string, TLog>;
  /** The snapshot from `proc.output`, covering events up to `cursor`. */
  reset: (procId: string, text: string, cursor: number) => void;
  /** A live `proc.output` event; ones already covered by the snapshot are ignored. */
  append: (procId: string, cursor: number, chunk: string) => void;
};

/** Live output of the processes a user is following (Logs tab). */
export const useProcLogStore = create<TProcLogState>()((set) => ({
  logs: {},
  reset: (procId, text, cursor) => {
    set((s) => ({ logs: { ...s.logs, [procId]: { text: stripAnsi(text).slice(-KEEP_CHARS), cursor } } }));
  },
  append: (procId, cursor, chunk) => {
    set((s) => {
      const log = s.logs[procId];
      if (!log || cursor <= log.cursor) return s;
      return {
        logs: { ...s.logs, [procId]: { text: (log.text + stripAnsi(chunk)).slice(-KEEP_CHARS), cursor } },
      };
    });
  },
}));
