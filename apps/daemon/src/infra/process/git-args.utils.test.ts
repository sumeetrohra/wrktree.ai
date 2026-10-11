import { describe, expect, it } from "vitest";

import { assertSafeGitArg } from "./git-args.utils.js";

describe("assertSafeGitArg (SEC5)", () => {
  it.each(["--upload-pack=touch /tmp/pwned", "-x", "", "main\u0000", "feat\nbranch"])(
    "rejects %j",
    (value) => {
      expect(() => assertSafeGitArg(value, "ref")).toThrow(expect.objectContaining({ code: "INVALID_ARGS" }));
    },
  );

  it.each(["main", "feature/login", "release-1.2", "HEAD~1"])("accepts %j", (value) => {
    expect(assertSafeGitArg(value, "ref")).toBe(value);
  });
});
