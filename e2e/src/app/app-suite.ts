import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, it } from "vitest";

import { Harness, REPO_ROOT } from "../harness.ts";

import { AppDriver } from "./app-driver.ts";
import type { TAppScenario } from "./app-scenarios.ts";

/** Runs app scenarios, each against a fresh stack and browser, with a screenshot on failure. */
export function appSuite(title: string, scenarios: TAppScenario[]): void {
  describe(title, () => {
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

    for (const s of scenarios) {
      it(`${String(s.n)}. ${s.title}`, async () => {
        h = await Harness.start(undefined, s.harness);
        app = await AppDriver.start(s.appHost ? { appHost: s.appHost } : {});
        await s.run(h, app);
      });
    }
  });
}
