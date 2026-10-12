import { afterEach, describe, it } from "vitest";

import { Harness } from "./harness.ts";
import { cloudScenarios } from "./scenarios/index.ts";

// Needs the Firebase emulators: `pnpm emulators "CLOUD_E2E=1 pnpm --filter @agentdeck/e2e test"`.
describe("Phase 3a end-to-end (cloud history, Firebase emulators)", () => {
  let h: Harness | null = null;
  afterEach(async () => {
    await h?.stop();
    h = null;
  });

  for (const s of cloudScenarios) {
    it(`${s.n}. ${s.title}`, async () => {
      h = await Harness.start(undefined, { firebase: true });
      await s.run(h);
    });
  }
});
