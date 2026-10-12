import { afterEach, describe, it } from "vitest";

import { Harness } from "./harness.ts";
import { relayScenarios } from "./scenarios/index.ts";

describe("Phase 2 end-to-end (relay)", () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.stop();
    h = null;
  });

  for (const s of relayScenarios) {
    it(`${s.n}. ${s.title}`, async () => {
      h = await Harness.start(undefined, { relay: true });
      await s.run(h);
    });
  }
});
