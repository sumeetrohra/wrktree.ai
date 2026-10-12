import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, it } from "vitest";

import { AppDriver } from "./app/app-driver.ts";
import { appScenarios } from "./app/app-scenarios.ts";
import { Harness, REPO_ROOT } from "./harness.ts";

describe("Phase 2 end-to-end (the app's web build)", () => {
  let h: Harness | null = null;
  let app: AppDriver | null = null;
  afterEach(async (ctx) => {
    // A screenshot of the page as it was when the scenario failed (CI uploads artifacts/).
    if (app && ctx.task.result?.state === "fail") {
      const dir = join(REPO_ROOT, "artifacts");
      mkdirSync(dir, { recursive: true });
      await app.page
        .screenshot({ path: join(dir, `app-e2e-failure-${ctx.task.name.split(".")[0] ?? "x"}.png`) })
        .catch(() => undefined);
    }
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
