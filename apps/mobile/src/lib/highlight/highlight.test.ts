import { languageFor, tokenize } from "./highlight";

describe("highlight", () => {
  it("picks a language by extension, or none", () => {
    expect(languageFor("src/app.ts")).toBe("typescript");
    expect(languageFor("Makefile")).toBeNull();
    expect(languageFor("a.toString")).toBeNull();
  });

  it("colors TypeScript line by line", async () => {
    const lines = await tokenize("const a = 1;\nexport {};", "typescript", false);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.map((t) => t.content).join("")).toBe("const a = 1;");
    expect(new Set(lines[0]?.map((t) => t.color)).size).toBeGreaterThan(1);
  });
});
