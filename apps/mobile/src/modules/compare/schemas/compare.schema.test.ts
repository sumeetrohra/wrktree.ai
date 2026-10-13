import { compareFormSchema, toggleProfile } from "./compare.schema";

describe("compare form", () => {
  it("needs a title, a prompt and two to four profiles", () => {
    const ok = { title: "Dark mode", prompt: "Add it", profileIds: ["a", "b"] };
    expect(compareFormSchema.safeParse(ok).success).toBe(true);
    expect(compareFormSchema.safeParse({ ...ok, profileIds: ["a"] }).success).toBe(false);
    expect(compareFormSchema.safeParse({ ...ok, profileIds: ["a", "b", "c", "d", "e"] }).success).toBe(false);
    expect(compareFormSchema.safeParse({ ...ok, prompt: "  " }).success).toBe(false);
  });

  it("toggles profiles in the order picked, up to four", () => {
    expect(toggleProfile([], "a")).toEqual(["a"]);
    expect(toggleProfile(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleProfile(["a", "b", "c", "d"], "e")).toEqual(["a", "b", "c", "d"]);
  });
});
