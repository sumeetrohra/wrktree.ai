import { TerminalBridge } from "./terminal-bridge.utils";

function setup() {
  const listeners: ((d: string) => void)[] = [];
  const input: string[] = [];
  const sizes: [number, number][] = [];
  const scripts: string[] = [];
  const bridge = new TerminalBridge({
    feed: {
      initial: "scrollback\r\n",
      subscribe: (write) => {
        listeners.push(write);
        return () => listeners.splice(listeners.indexOf(write), 1);
      },
    },
    label: "Terminal",
    onInput: (d) => input.push(d),
    onResize: (cols, rows) => sizes.push([cols, rows]),
  });
  bridge.attach({ injectJavaScript: (s) => scripts.push(s) });
  return { bridge, listeners, input, sizes, scripts };
}

describe("TerminalBridge", () => {
  it("writes the scrollback and live output once the page is ready", () => {
    const { bridge, listeners, sizes, scripts } = setup();
    expect(scripts).toEqual([]);
    bridge.message(JSON.stringify({ type: "ready", cols: 40, rows: 20 }));
    expect(sizes).toEqual([[40, 20]]);
    expect(scripts).toEqual(['window.agentdeckWrite("scrollback\\r\\n");true;']);
    listeners.forEach((l) => {
      l("</script>\u001b[1mhi");
    });
    expect(scripts[1]).toBe('window.agentdeckWrite("</script>\\u001b[1mhi");true;');
  });

  it("forwards keystrokes and resizes, and ignores anything else", () => {
    const { bridge, input, sizes } = setup();
    bridge.message(JSON.stringify({ type: "input", data: "ls\r" }));
    bridge.message(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    bridge.message("not json");
    bridge.message(JSON.stringify({ type: "eval", code: "x" }));
    expect(input).toEqual(["ls\r"]);
    expect(sizes).toEqual([[100, 30]]);
  });

  it("stops writing once detached", () => {
    const { bridge, listeners, scripts } = setup();
    bridge.message(JSON.stringify({ type: "ready", cols: 40, rows: 20 }));
    bridge.detach();
    expect(listeners).toHaveLength(0);
    expect(scripts).toHaveLength(1);
  });
});
