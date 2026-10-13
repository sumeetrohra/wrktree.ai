import { stripAnsi } from "./ansi.utils";

describe("stripAnsi", () => {
  it("drops colors and cursor codes, keeps the text", () => {
    expect(stripAnsi("\u001b[32m✓\u001b[39m ready in \u001b[1m300\u001b[22mms\n")).toBe("✓ ready in 300ms\n");
    expect(stripAnsi("50%\r100%\r\n")).toBe("50%100%\r\n");
  });
});
