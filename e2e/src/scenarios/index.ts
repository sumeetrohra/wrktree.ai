import type { TScenario } from "../scenario.ts";

import { chatLifecycle } from "./chat-lifecycle.scenario.ts";
import { crashRestart } from "./crash-restart.scenario.ts";
import { goldenPath } from "./golden-path.scenario.ts";
import { pathJail } from "./path-jail.scenario.ts";
import { permissions } from "./permissions.scenario.ts";
import { streamingBlobs } from "./streaming-blobs.scenario.ts";
import { worktreeLifecycle } from "./worktree-lifecycle.scenario.ts";

export const scenarios: TScenario[] = [
  goldenPath,
  crashRestart,
  pathJail,
  chatLifecycle,
  permissions,
  worktreeLifecycle,
  streamingBlobs,
];
