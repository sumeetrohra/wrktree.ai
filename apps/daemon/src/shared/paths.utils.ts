import { homedir } from "node:os";
import { join } from "node:path";

import { readDaemonEnv } from "./env.schema.js";

export type TPaths = {
  home: string;
  db: string;
  events: string;
  blobs: string;
  profiles: string;
  shared: string;
  logs: string;
  /** Written on start: `{ pid, port, version }` so the CLI can find the daemon. */
  daemonJson: string;
  /** Local transport bearer token, mode 0600. */
  localToken: string;
};

/** The daemon's data folder. `AGENTDECK_HOME` overrides it (tests, multiple daemons). */
export function defaultHome(): string {
  const env = readDaemonEnv();
  if (env.AGENTDECK_HOME !== undefined) return env.AGENTDECK_HOME;
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "agentdeck");
    case "win32":
      return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "agentdeck");
    default:
      return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "agentdeck");
  }
}

export function pathsFor(home: string): TPaths {
  return {
    home,
    db: join(home, "agentdeck.db"),
    events: join(home, "events"),
    blobs: join(home, "blobs"),
    profiles: join(home, "profiles"),
    shared: join(home, "shared"),
    logs: join(home, "logs"),
    daemonJson: join(home, "daemon.json"),
    localToken: join(home, "local-token"),
  };
}
