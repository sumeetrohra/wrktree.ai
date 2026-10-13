import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import type { TTerminalViewProps } from "./terminal.types";

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), cols: z.number().int(), rows: z.number().int() }),
  z.object({ type: z.literal("input"), data: z.string() }),
  z.object({ type: z.literal("resize"), cols: z.number().int(), rows: z.number().int() }),
]);

/** The page in the WebView, as far as the bridge needs: run a script in it. */
export interface ITerminalPage {
  injectJavaScript: (script: string) => void;
}

/**
 * Connects the xterm.js page in a WebView (phones) to the app: messages from the page become input
 * and resizes; output is written into the page once it says it is ready.
 */
export class TerminalBridge {
  private page: ITerminalPage | null = null;
  private ready = false;
  private off: (() => void) | null = null;

  constructor(private readonly props: TTerminalViewProps) {}

  attach(page: ITerminalPage | null): void {
    if (page === null) {
      this.detach();
      return;
    }
    this.page = page;
  }

  detach(): void {
    this.off?.();
    this.off = null;
    this.page = null;
    this.ready = false;
  }

  /** A `postMessage` from the page. Anything that doesn't parse is ignored. */
  message(raw: string): void {
    const m = tryParseJson(messageSchema, raw);
    if (m === undefined) return;
    if (m.type === "input") {
      this.props.onInput(m.data);
      return;
    }
    this.props.onResize(m.cols, m.rows);
    if (m.type === "ready" && !this.ready) {
      this.ready = true;
      this.write(this.props.feed.initial);
      this.off = this.props.feed.subscribe((d) => {
        this.write(d);
      });
    }
  }

  private write(data: string): void {
    if (data === "" || this.page === null) return;
    this.page.injectJavaScript(`window.agentdeckWrite(${JSON.stringify(data)});true;`);
  }
}
