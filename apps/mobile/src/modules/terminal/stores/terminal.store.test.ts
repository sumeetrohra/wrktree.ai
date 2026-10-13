import { appendOutput, resetOutput, terminalFeed } from "./terminal.store";

describe("terminal output", () => {
  it("starts from the scrollback, then streams only events after it", () => {
    resetOutput("term_a", "$ ls\r\n", 3);
    appendOutput("term_a", 2, "old");
    const seen: string[] = [];
    const feed = terminalFeed("term_a");
    expect(feed.initial).toBe("$ ls\r\n");
    const off = feed.subscribe((d) => {
      seen.push(d);
    });
    appendOutput("term_a", 3, "dup");
    appendOutput("term_a", 4, "file.txt\r\n");
    off();
    appendOutput("term_a", 5, "after");
    expect(seen).toEqual(["file.txt\r\n"]);
    expect(terminalFeed("term_a").initial).toBe("$ ls\r\nfile.txt\r\nafter");
  });
});
