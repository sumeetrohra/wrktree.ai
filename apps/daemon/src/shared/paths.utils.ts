import { homedir } from "node:os";
import { join } from "node:path";

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
  const override = process.env.AGENTDECK_HOME;
  if (override) return override;
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "agentdeck");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "agentdeck");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "agentdeck");
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
