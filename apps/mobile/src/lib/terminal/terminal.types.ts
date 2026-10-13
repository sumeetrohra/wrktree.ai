/** What a terminal view shows: the scrollback so far, then live output. */
export type TTerminalFeed = {
  initial: string;
  /** Calls `write` with each new chunk; returns the unsubscribe. */
  subscribe: (write: (data: string) => void) => () => void;
};

export type TTerminalViewProps = {
  feed: TTerminalFeed;
  label: string;
  /** Keystrokes, encoded as the terminal sends them. */
  onInput: (data: string) => void;
  /** The view's size in characters, after it fits its box. */
  onResize: (cols: number, rows: number) => void;
};
