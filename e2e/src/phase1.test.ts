import { afterEach, describe, it } from "vitest";
import { Harness } from "./harness.ts";
import { scenarios } from "./scenarios/index.ts";

describe("Phase 1 end-to-end", () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.stop();
    h = null;
  });

  for (const s of scenarios) {
    it(`${s.n}. ${s.title}`, async () => {
      h = await Harness.start();
      await s.run(h);
    });
  }
});
