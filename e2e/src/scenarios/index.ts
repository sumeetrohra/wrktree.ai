import type { Scenario } from "../scenario.ts";
import { goldenPath } from "./01-golden-path.ts";
import { crashRestart } from "./02-crash-restart.ts";
import { pathJail } from "./03-path-jail.ts";
import { chatLifecycle } from "./04-chat-lifecycle.ts";
import { permissions } from "./05-permissions.ts";
import { worktreeLifecycle } from "./06-worktree-lifecycle.ts";
import { streamingBlobs } from "./07-streaming-blobs.ts";

export const scenarios: Scenario[] = [
  goldenPath,
  crashRestart,
  pathJail,
  chatLifecycle,
  permissions,
  worktreeLifecycle,
  streamingBlobs,
];
