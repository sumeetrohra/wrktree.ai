import { branchFor } from "./new-task.schema";

describe("branchFor", () => {
  it("slugs the title under task/ and never starts with a dash", () => {
    expect(branchFor("Fix the login redirect!")).toBe("task/fix-the-login-redirect");
    expect(branchFor("--upload-pack=evil")).toBe("task/upload-pack-evil");
    expect(branchFor("???")).toBe("task/untitled");
  });
});
