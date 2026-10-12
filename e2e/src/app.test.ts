import { afterEach, describe, it } from "vitest";

import { AppDriver } from "./app/app-driver.ts";
import { appScenarios } from "./app/app-scenarios.ts";
import { Harness } from "./harness.ts";

describe("Phase 2b end-to-end (the app's web build)", () => {
  let h: Harness | null = null;
  let app: AppDriver | null = null;
  afterEach(async () => {
    await app?.stop();
    await h?.stop();
    app = null;
    h = null;
  });

  for (const s of appScenarios) {
    it(`${String(s.n)}. ${s.title}`, async () => {
      h = await Harness.start(undefined, s.harness);
      app = await AppDriver.start();
      await s.run(h, app);
    });
  }
});
