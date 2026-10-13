import { describe, expect, it } from "vitest";

import { parsePrDraft } from "./pr-draft.utils.js";

describe("parsePrDraft", () => {
  it("reads Title: and the body after it", () => {
    expect(
      parsePrDraft("Title: Fix the login redirect\n\nStops the double redirect.\n\n- adds a test"),
    ).toEqual({
      title: "Fix the login redirect",
      body: "Stops the double redirect.\n\n- adds a test",
    });
  });

  it("tolerates bold labels, a Description: label, and a fenced reply", () => {
    expect(parsePrDraft("```\n**Title:** Add caching\n\n**Description:** Caches the list.\n```")).toEqual({
      title: "Add caching",
      body: "Caches the list.",
    });
  });

  it("falls back to the first line as the title", () => {
    expect(parsePrDraft("\n# Add caching\nCaches the list.")).toEqual({
      title: "Add caching",
      body: "Caches the list.",
    });
    expect(parsePrDraft("Titles are hard\nbody")).toEqual({ title: "Titles are hard", body: "body" });
    expect(parsePrDraft("   ")).toEqual({ title: "", body: "" });
  });
});
