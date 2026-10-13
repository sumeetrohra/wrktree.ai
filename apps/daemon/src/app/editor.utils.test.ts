import { describe, expect, it } from "vitest";

import { editorCommand } from "./editor.utils.js";

describe("editorCommand", () => {
  it("uses each editor's launcher on macOS and Linux", () => {
    expect(editorCommand("vscode", "/w", "/w/src/a.ts", 12, "darwin")).toEqual([
      "code",
      "/w",
      "--goto",
      "/w/src/a.ts:12",
    ]);
    expect(editorCommand("cursor", "/w", null, undefined, "linux")).toEqual(["cursor", "/w"]);
    expect(editorCommand("zed", "/w", "/w/a.ts", 3, "linux")).toEqual(["zed", "/w", "/w/a.ts:3"]);
  });

  it("opens the editor's URL on Windows (no shell)", () => {
    expect(editorCommand("vscode", "C:\\w", "C:\\w\\my file.ts", 2, "win32")).toEqual([
      "rundll32",
      "url.dll,FileProtocolHandler",
      "vscode://file/C:/w/my%20file.ts:2",
    ]);
  });
});
