import type { Logger } from "@agentdeck/shared";
import type { EventBus } from "./bus.js";
import type { Db } from "./db/index.js";
import type { Paths } from "./paths.js";

export type DaemonOptions = {
  home: string;
  /** Folders `fs.browse` and `repo.add` may reach. Defaults to the user's home folder. */
  browseRoots: string[];
  portRange: [number, number];
  /** Register the scripted `fake` agent (tests and demos only). */
  devAgents: boolean;
  /** Backoff before each automatic adapter restart, in ms. */
  restartBackoffMs: number[];
  /** Coalescing window for streaming patches (≤ 20 per second per chat by default). */
  patchIntervalMs: number;
};

/** What every module gets: storage, the event bus, logging and options. */
export type Ctx = {
  db: Db;
  bus: EventBus;
  paths: Paths;
  log: Logger;
  opts: DaemonOptions;
};
