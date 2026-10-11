import { describe, expect, it } from "vitest";
import { hasPrefix, newId } from "./ids.utils.js";

describe("newId", () => {
  it("prefixes a ULID and sorts by creation time", () => {
    const a = newId("wt");
    const b = newId("wt");
    expect(a).toMatch(/^wt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(hasPrefix(a, "wt")).toBe(true);
    expect(hasPrefix(a, "chat")).toBe(false);
    expect(a < b).toBe(true);
  });
});
