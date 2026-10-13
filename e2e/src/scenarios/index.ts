import type { TScenario } from "../scenario.ts";

import { chatLifecycle } from "./chat-lifecycle.scenario.ts";
import { crashRestart } from "./crash-restart.scenario.ts";
import { goldenPath } from "./golden-path.scenario.ts";
import { housekeeping } from "./housekeeping.scenario.ts";
import { pathJail } from "./path-jail.scenario.ts";
import { permissions } from "./permissions.scenario.ts";
import { relayChat } from "./relay-chat.scenario.ts";
import { relayCloud } from "./relay-cloud.scenario.ts";
import { relayCompare } from "./relay-compare.scenario.ts";
import { relayHandoff } from "./relay-handoff.scenario.ts";
import { relayLogin } from "./relay-login.scenario.ts";
import { relayMultiHost } from "./relay-multi-host.scenario.ts";
import { relayOffline } from "./relay-offline.scenario.ts";
import { relayPlaintext } from "./relay-plaintext.scenario.ts";
import { relayPreview } from "./relay-preview.scenario.ts";
import { relayProcs } from "./relay-procs.scenario.ts";
import { relayRevoke } from "./relay-revoke.scenario.ts";
import { relaySharedConfig } from "./relay-shared-config.scenario.ts";
import { relayShip } from "./relay-ship.scenario.ts";
import { relayTerminal } from "./relay-terminal.scenario.ts";
import { relayUsage } from "./relay-usage.scenario.ts";
import { streamingBlobs } from "./streaming-blobs.scenario.ts";
import { videoAttachment } from "./video-attachment.scenario.ts";
import { worktreeLifecycle } from "./worktree-lifecycle.scenario.ts";

export const scenarios: TScenario[] = [
  goldenPath,
  crashRestart,
  pathJail,
  chatLifecycle,
  permissions,
  worktreeLifecycle,
  streamingBlobs,
  housekeeping,
  videoAttachment,
];

/** Phase 2: the same daemon, reached from a phone through a local relay. */
export const relayScenarios: TScenario[] = [
  relayLogin,
  relayChat,
  relayOffline,
  relayRevoke,
  relayPlaintext,
  relayMultiHost,
  relayShip,
  relayProcs,
  relayPreview,
  relayUsage,
  relayHandoff,
  relaySharedConfig,
  relayTerminal,
  relayCompare,
];

/** Phase 3a: chat history in Firebase (needs the emulators). */
export const cloudScenarios: TScenario[] = [relayCloud];
