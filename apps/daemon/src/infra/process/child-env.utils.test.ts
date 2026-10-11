import { afterEach, describe, expect, it } from "vitest";

import { childEnv } from "./child-env.utils.js";

describe("childEnv (SEC6)", () => {
  afterEach(() => {
    delete process.env["AGENTDECK_TEST_SECRET"];
  });

  it("drops variables that aren't allow-listed", () => {
    process.env["AGENTDECK_TEST_SECRET"] = "sk_live_canary";
    const env = childEnv();
    expect(env["AGENTDECK_TEST_SECRET"]).toBeUndefined();
    expect(Object.values(env)).not.toContain("sk_live_canary");
  });

  it("keeps PATH and adds the extras, which win", () => {
    const env = childEnv({ CLAUDE_CONFIG_DIR: "/profiles/p1", PATH: "/custom" });
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/profiles/p1");
    expect(env["PATH"]).toBe("/custom");
  });
});
