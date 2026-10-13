import { parseUnifiedDiff } from "./diff.utils";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@ export function login
 export function login(user: string) {
-  return user.length > 0;
+  const ok = user.length > 0;
+  return ok;
 }
\\ No newline at end of file
`;

describe("parseUnifiedDiff", () => {
  it("numbers each side and keeps the hunk header", () => {
    const rows = parseUnifiedDiff(DIFF);
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "ctx", "del", "add", "add", "ctx"]);
    expect(rows[1]).toEqual({
      kind: "ctx",
      text: "export function login(user: string) {",
      oldNo: 1,
      newNo: 1,
    });
    expect(rows[2]).toEqual({ kind: "del", text: "  return user.length > 0;", oldNo: 2 });
    expect(rows[4]).toEqual({ kind: "add", text: "  return ok;", newNo: 3 });
    expect(rows[5]).toMatchObject({ oldNo: 3, newNo: 4 });
  });

  it("reads a new file diff", () => {
    const rows = parseUnifiedDiff("--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n");
    expect(rows.slice(1)).toEqual([
      { kind: "add", text: "one", newNo: 1 },
      { kind: "add", text: "two", newNo: 2 },
    ]);
  });
});
