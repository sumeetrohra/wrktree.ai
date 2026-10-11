import type { ILogger } from "@agentdeck/shared";

import type { TDaemonOptions } from "#src/shared/daemon-options.types.js";
import type { TPaths } from "#src/shared/paths.utils.js";

import type { EventBus } from "../bus/index.js";
import type { TDb } from "../db/index.js";

/** What every module gets: storage, the event bus, logging, paths and options. */
export type TRuntime = {
  db: TDb;
  bus: EventBus;
  paths: TPaths;
  log: ILogger;
  opts: TDaemonOptions;
};
