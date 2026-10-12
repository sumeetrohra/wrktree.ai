import type { TScenario } from "../scenario.ts";

import { chatLifecycle } from "./chat-lifecycle.scenario.ts";
import { crashRestart } from "./crash-restart.scenario.ts";
import { goldenPath } from "./golden-path.scenario.ts";
import { pathJail } from "./path-jail.scenario.ts";
import { permissions } from "./permissions.scenario.ts";
import { relayChat } from "./relay-chat.scenario.ts";
import { relayOffline } from "./relay-offline.scenario.ts";
import { relayPairing } from "./relay-pairing.scenario.ts";
import { relayPlaintext } from "./relay-plaintext.scenario.ts";
import { relayRevoke } from "./relay-revoke.scenario.ts";
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

/** Phase 2: the same daemon, reached from a phone through a local relay. */
export const relayScenarios: TScenario[] = [
  relayPairing,
  relayChat,
  relayOffline,
  relayRevoke,
  relayPlaintext,
];
