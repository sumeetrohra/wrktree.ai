import { fuzzyFilter, fuzzyScore } from "./fuzzy.utils";

describe("fuzzy", () => {
  it("matches characters in order, case-insensitively", () => {
    expect(fuzzyScore("apts", "app.ts")).not.toBeNull();
    expect(fuzzyScore("tsa", "app.ts")).toBeNull();
  });

  it("ranks tight and word-start matches first", () => {
    const names = ["login-page.tsx", "lib/go.ts", "longinput.ts"];
    expect(fuzzyFilter("lp", names, (n) => n)).toEqual(["login-page.tsx", "longinput.ts"]);
    expect(fuzzyFilter("login", names, (n) => n)[0]).toBe("login-page.tsx");
    expect(fuzzyFilter("", names, (n) => n)).toHaveLength(3);
  });
});
