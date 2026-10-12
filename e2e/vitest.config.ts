import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The app scenarios need a Playwright Chromium and the web export; CI runs them in their own
    // job (APP_E2E=1), and `pnpm test:e2e:app` runs them locally.
    exclude: process.env.APP_E2E === "1" ? [] : ["src/app.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
