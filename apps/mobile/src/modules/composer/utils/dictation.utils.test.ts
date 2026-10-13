import { DictationSession } from "./dictation.utils";

describe("DictationSession", () => {
  it("keeps the typed text, accumulates utterances, and replaces the one in progress", () => {
    const s = new DictationSession("Fix the bug ");
    expect(s.result("in the", false)).toBe("Fix the bug in the");
    expect(s.result("in the login page.", true)).toBe("Fix the bug in the login page.");
    expect(s.result("Then", false)).toBe("Fix the bug in the login page. Then");
    expect(s.result("Then add a test.", true)).toBe("Fix the bug in the login page. Then add a test.");
  });

  it("starts from an empty composer", () => {
    expect(new DictationSession("").result("hello", false)).toBe("hello");
  });
});
