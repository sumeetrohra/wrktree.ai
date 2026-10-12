import { cloudAppScenarios } from "./app/app-scenarios.ts";
import { appSuite } from "./app/app-suite.ts";

// Needs the web export and the Firebase emulators:
// `pnpm emulators "APP_E2E=1 CLOUD_E2E=1 pnpm --filter @agentdeck/e2e exec vitest run src/cloud-app.test.ts"`.
appSuite("Phase 3a end-to-end (the app reads cloud history)", cloudAppScenarios);
