import { applyPatch } from "./apply-patch.utils";

describe("applyPatch", () => {
  it("only touches the fields an item kind has", () => {
    expect(
      applyPatch(
        { kind: "tool", id: "t", at: 0, title: "Read", toolKind: "read", status: "running" },
        { status: "done", text: "x" },
      ),
    ).toEqual({
      kind: "tool",
      id: "t",
      at: 0,
      title: "Read",
      toolKind: "read",
      status: "done",
    });
    const user = { kind: "user" as const, id: "u", at: 0, text: "hi", attachments: [] };
    expect(applyPatch(user, { text: "changed" })).toBe(user);
  });
});
