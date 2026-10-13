import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useState } from "react";

import type { TTerminalViewProps } from "./terminal.types";

/** Mounts xterm.js into the element and wires it to the feed; returns the teardown. */
function mount(el: HTMLDivElement, { feed, onInput, onResize }: TTerminalViewProps): () => void {
  const term = new Terminal({ fontSize: 13, cursorBlink: true, scrollback: 5000 });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.write(feed.initial);
  const off = feed.subscribe((d) => {
    term.write(d);
  });
  term.onData(onInput);
  term.onResize(({ cols, rows }) => {
    onResize(cols, rows);
  });
  const observer = new ResizeObserver(() => {
    fit.fit();
  });
  observer.observe(el);
  fit.fit();
  onResize(term.cols, term.rows);
  term.focus();
  return () => {
    observer.disconnect();
    off();
    term.dispose();
  };
}

/** A terminal in the web build: xterm.js in the page. Remount (a new `key`) for another terminal. */
export function TerminalView(props: TTerminalViewProps): React.JSX.Element {
  const [attach] = useState(
    () => (el: HTMLDivElement | null) => (el === null ? undefined : mount(el, props)),
  );
  return <div ref={attach} aria-label={props.label} className="h-full w-full" />;
}
